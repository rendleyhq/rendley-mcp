import { z } from "zod";
import { ApiError } from "@/api/client";
import { RemoteBrowserError } from "@/sdk/remote-browser";
import type { ToolTextResponse } from "@/types/mcp.types";

export type { ToolTextResponse };

// Must be passthrough: an empty {} shape emits no schema at all.
export const outputAny = z.object({}).passthrough();

export function ok(text: string): ToolTextResponse {
  return { content: [{ type: "text", text }] };
}

export function fail(text: string): ToolTextResponse {
  return { content: [{ type: "text", text: `❌ ${text}` }], isError: true };
}

const REMOTE_BROWSER_MESSAGES: Record<string, string> = {
  TIMEOUT:
    "the edit took too long and was stopped. Try again, ideally with a smaller scope.",
  ABORTED: "the edit was cancelled before it finished.",
  WORKER_UNREACHABLE:
    "the video editor service is temporarily unreachable. Please retry in a moment.",
  WORKER_HTTP_ERROR:
    "the video editor service returned an error. Please retry in a moment.",
  EMPTY_STREAM:
    "the video editor service returned no result. Please retry in a moment.",
  NO_RESULT:
    "the video editor service closed without returning a result. Please retry in a moment.",
  NOT_CONFIGURED: "the video editor service is not configured.",
};

export function formatError(err: unknown): string {
  if (ApiError.isApiError(err)) {
    return `[${err.code}] ${err.message} (HTTP ${err.status})`;
  }
  if (err instanceof RemoteBrowserError) {
    return REMOTE_BROWSER_MESSAGES[err.code] ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export { bytes, truncate, table } from "@/utils/format";
