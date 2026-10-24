// Fixed-window rate limiter held in memory.

const windows = new Map<string, { resetAt: number; count: number }>();
const MAX_KEYS = 10_000;

// True if the request is allowed; false once `key` exceeds `limit` requests
// within `windowMs`.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (w && now < w.resetAt) return ++w.count <= limit;

  if (windows.size >= MAX_KEYS) {
    for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
  }
  windows.set(key, { resetAt: now + windowMs, count: 1 });
  return true;
}

// Best-effort client IP. Only trustworthy behind a proxy that sets these
// headers itself (e.g. Vercel)
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function tooManyRequests() {
  return Response.json(
    { error: "too many requests" },
    { status: 429, headers: { "Retry-After": "10" } },
  );
}
