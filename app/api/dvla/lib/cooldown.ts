const lastRequest: Map<string, number> = new Map();

/** Cooldown: per-IP (2s) and per-IP+VRM (10s). */
export function simpleCooldown(ip: string, vrm: string) {
  const now = Date.now();
  const ipKey = `ip:${ip}`;
  const ipVrmKey = `ipvrm:${ip}:${vrm}`;

  const tooSoon = (key: string, ms: number) => {
    const last = lastRequest.get(key) || 0;
    if (now - last < ms) return true;
    lastRequest.set(key, now);
    return false;
  };

  if (tooSoon(ipVrmKey, 10_000))
    return { blocked: true, retryAfterSec: 10, which: "IP+VRM" as const };
  if (tooSoon(ipKey, 2_000))
    return { blocked: true, retryAfterSec: 2, which: "IP" as const };
  return { blocked: false, retryAfterSec: 0, which: null as any };
}

export function rateLimitResponse(
  withCors: (body: any, status?: number, origin?: string | null) => any,
  retryAfterSec: number,
  which: string
) {
  return withCors(
    {
      ok: false,
      error: 429,
      message: `Rate limit hit (${which}). Try again in ~${retryAfterSec}s.`,
    },
    429
  );
}
