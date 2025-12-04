type RateEntry = { count: number; windowStart: number };

const RATE_WINDOW_MS = 60_000; // 1 minute bucket
export const RATE_IP_MAX = 5;
export const RATE_EMAIL_MAX = 3;

const ipRate: Map<string, RateEntry> = new Map();
const emailRate: Map<string, RateEntry> = new Map();

function hitRateLimiter(
  key: string | null | undefined,
  map: Map<string, RateEntry>,
  limit: number
) {
  if (!key) return false;
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now - existing.windowStart > RATE_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return false;
  }
  existing.count += 1;
  if (existing.count > limit) return true;
  return false;
}

export function rateLimitIp(ip: string | null) {
  return hitRateLimiter(ip, ipRate, RATE_IP_MAX);
}

export function rateLimitEmail(email: string | null) {
  return hitRateLimiter(email, emailRate, RATE_EMAIL_MAX);
}
