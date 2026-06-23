// Key by user id, not IP: MCP connectors share egress IPs, so per-IP would throttle unrelated callers.
import type { MiddlewareHandler } from "hono";
import { config } from "@/config";
import { log } from "@/logger";
import { recordRateLimited } from "@/metrics";
import type { AppEnv } from "@/middlewares/auth";

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 50_000;

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export const userRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const max = config.rateLimit.max;
  if (max <= 0) return next();
  const key = c.get("userId");
  if (!key) return next();

  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + config.rateLimit.windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    recordRateLimited();
    log.warn("rate_limited", { retryAfterSeconds: retryAfter });
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Retry shortly.",
          retryAfterSeconds: retryAfter,
        },
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }
  return next();
};
