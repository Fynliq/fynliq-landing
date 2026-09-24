const windows = new Map();
// Per-instance backstop; deployment firewall limits are still required for scale.
export function allowRequest(req, route, limit) {
  const now = Date.now();
  for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim();
  const key = `${route}:${ip}`;
  const value = windows.get(key) ?? { count: 0, until: now + 60000 };
  if (value.count >= limit || windows.size >= 10000) return false;
  value.count++; windows.set(key, value); return true;
}
