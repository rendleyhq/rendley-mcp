// tryAcquire/release must be paired (release in a finally) or slots leak.
const inFlight = new Map<string, number>();

export function tryAcquire(key: string, max: number): boolean {
  const current = inFlight.get(key) ?? 0;
  if (current >= max) return false;
  inFlight.set(key, current + 1);
  return true;
}

export function release(key: string): void {
  const current = inFlight.get(key) ?? 0;
  if (current <= 1) {
    inFlight.delete(key);
    return;
  }
  inFlight.set(key, current - 1);
}

export function acquireAll(reqs: { key: string; max: number }[]): boolean {
  const acquired: string[] = [];
  for (const { key, max } of reqs) {
    if (!tryAcquire(key, max)) {
      for (const k of acquired) release(k);
      return false;
    }
    acquired.push(key);
  }
  return true;
}

export function releaseAll(keys: string[]): void {
  for (const k of keys) release(k);
}

export interface ConcurrencyKeys {
  tenantKey: string;
  endUserKey: string;
}

export function resolveKeys(
  userId: string,
  endUserId?: string | null,
): ConcurrencyKeys {
  return {
    tenantKey: userId,
    endUserKey: endUserId ? `${userId}:${endUserId}` : userId,
  };
}
