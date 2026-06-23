export class UrlGuardError extends Error {
  constructor(
    public code: "invalid_url" | "unsupported_protocol",
    message: string,
  ) {
    super(message);
    this.name = "UrlGuardError";
  }
}

export function validateExternalUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlGuardError("invalid_url", "URL is malformed");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError(
      "unsupported_protocol",
      `protocol ${url.protocol} is not supported`,
    );
  }

  return url;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  body: Buffer;
  contentType: string;
  size: number;
}

// Stream cap enforced while reading: a hostile server can't OOM us by lying about Content-Length.
export async function safeFetchMedia(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<SafeFetchResult> {
  validateExternalUrl(rawUrl);

  const res = await fetch(rawUrl, {
    headers: opts.headers,
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`fetch_failed:${res.status}`);
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    throw new Error(`payload_too_large:${declared}`);
  }

  if (!res.body) throw new Error("empty_body");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`payload_too_large:${total}+`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const body = Buffer.concat(
    chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
  );
  return {
    body,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    size: total,
  };
}
