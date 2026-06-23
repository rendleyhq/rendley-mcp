import type { ApiClient } from "@/api/client";
import { config } from "@/config";
import { log } from "@/logger";
import { recordPlanDowngrade } from "@/metrics";

const HIT_TTL_MS = 60_000;
const ERROR_TTL_MS = 10_000;

const cache = new Map<string, { cap: number; expiresAt: number }>();

const MAX_CACHE_ENTRIES = 10_000;

function sweepExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export async function resolvePlanCap(
  userId: string,
  apiClient: ApiClient,
): Promise<number> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.cap;
  if (hit) cache.delete(userId);
  if (cache.size > MAX_CACHE_ENTRIES) sweepExpired(now);

  try {
    const tier = await apiClient.getPlanTier();
    const cap = config.planConcurrency[tier] ?? config.planConcurrency.free;
    log.debug("plan_cap_resolved", { tier, cap });
    cache.set(userId, { cap, expiresAt: now + HIT_TTL_MS });
    return cap;
  } catch (err) {
    recordPlanDowngrade();
    log.warn("plan_cap_resolve_failed", { err });
    const cap = config.planConcurrency.free;
    cache.set(userId, { cap, expiresAt: now + ERROR_TTL_MS });
    return cap;
  }
}
