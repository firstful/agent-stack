import type { Context, Next } from "hono";
import type { RedisClientType } from "redis";

// ═══════════════════════════════════════════════════════════
// Rate limiting middleware — Redis-backed, three dimensions
// ═══════════════════════════════════════════════════════════

// ── Types ──

export interface RateLimitCategory {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests allowed within the window */
  maxRequests: number;
}

export interface RateLimitConfig {
  [category: string]: RateLimitCategory;
}

export interface RateLimitOptions {
  /** Connected Redis client */
  redis: RedisClientType;
  /** Category overrides (merged with defaults) */
  config?: Partial<RateLimitConfig>;
  /** Optional Redis key prefix for multi-tenancy */
  prefix?: string;
  /** Predicate to skip rate limiting for certain requests */
  skip?: (c: Context) => boolean;
}

// ── Default categories ──

export const DEFAULT_CATEGORIES: RateLimitConfig = {
  read:  { windowMs: 60_000, maxRequests: 60  },  // 60 req/min  (GET)
  write: { windowMs: 60_000, maxRequests: 20  },  // 20 req/min  (POST/PUT/PATCH/DELETE)
  auth:  { windowMs: 60_000, maxRequests: 5   },  //  5 req/min  (register)
};

// ── Route → category resolution ──

/**
 * Map an HTTP method + path to a rate-limit category.
 * Returns `null` for unmonitored paths (health, etc.).
 */
export function categorizeRequest(method: string, path: string): string | null {
  if (path === "/health" || path === "/") return null;

  // Auth endpoints (register is strictly limited)
  if (path.startsWith("/api/auth/")) {
    return method === "POST" ? "auth" : "read";
  }

  // Read-only operations get generous limits
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return "read";
  }

  // Everything else is a write
  return "write";
}

// ── Helpers ──

/**
 * Parse the first group ID from a URL path, if the path is
 * targeting a specific group.
 */
export function extractGroupId(path: string): string | null {
  const match = path.match(/^\/api\/groups\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Best-effort client IP from forwarding headers or the socket address.
 */
export function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

// ── Dimension check ──

interface CheckResult {
  allowed: boolean;
  current: number;
  retryAfter: number;
}

/**
 * Atomically increment a fixed-window counter in Redis.
 * Returns whether the request is within limit and the seconds
 * until the window resets.
 */
async function checkDimension(
  redis: RedisClientType,
  key: string,
  max: number,
  windowMs: number,
  now: number,
): Promise<CheckResult> {
  const windowIdx = Math.floor(now / windowMs);
  const redisKey = `rate:${key}:${windowIdx}`;

  const count = await redis.incr(redisKey);

  if (count === 1) {
    // First request in this window — set TTL
    const ttl = Math.ceil(windowMs / 1000);
    await redis.expire(redisKey, ttl);
    return {
      allowed: true,
      current: count,
      retryAfter: Math.ceil(((windowIdx + 1) * windowMs - now) / 1000),
    };
  }

  let ttl = await redis.ttl(redisKey);
  if (ttl < 0) {
    // Safety: key exists but has no expiry — set one
    ttl = Math.ceil(windowMs / 1000);
    await redis.expire(redisKey, ttl);
  }

  return {
    allowed: count <= max,
    current: count,
    retryAfter: ttl,
  };
}

// ── Middleware factory ──

/**
 * Creates a Hono middleware that enforces rate limits across
 * three dimensions:
 *   - Per‑IP (always checked)
 *   - Per‑user (checked when x-user-id header is present)
 *   - Per‑group (checked when URL targets `/api/groups/:id`)
 *
 * Rate-limit categories are chosen by `categorizeRequest()` and
 * their window / max values come from the merged config.
 *
 * On rejection the handler returns HTTP 429 with:
 *   - `Retry-After` header (seconds until the window resets)
 *   - `X-RateLimit-Limit` (max requests in the window)
 *   - `X-RateLimit-Remaining` (0)
 *   - `X-RateLimit-Window` (window duration in ms)
 *   - `X-RateLimit-Dimension` (which dimension triggered the block)
 */
export function rateLimitMiddleware(opts: RateLimitOptions) {
  const redis = opts.redis;
  const config: RateLimitConfig = { ...DEFAULT_CATEGORIES, ...opts.config };
  const prefix = opts.prefix ?? "";

  return async (c: Context, next: Next) => {
    if (opts.skip?.(c)) {
      return next();
    }

    const method = c.req.method;
    const path = c.req.path;
    const category = categorizeRequest(method, path);

    if (!category) {
      return next();
    }

    const catConfig = config[category];
    if (!catConfig) {
      return next();
    }

    const now = Date.now();
    const userId = c.req.header("x-user-id");
    const ip = getClientIp(c);
    const groupId = extractGroupId(path);

    // Assemble dimensions — IP is always checked, user & group are conditional
    const dimensions: Array<{ key: string; max: number; label: string }> = [
      { key: `${prefix}ip:${ip}:${category}`, max: catConfig.maxRequests, label: "ip" },
    ];
    if (userId) {
      dimensions.push({ key: `${prefix}user:${userId}:${category}`, max: catConfig.maxRequests, label: "user" });
    }
    if (groupId) {
      dimensions.push({ key: `${prefix}group:${groupId}:${category}`, max: catConfig.maxRequests, label: "group" });
    }

    // Check each dimension — reject on first violation
    for (const dim of dimensions) {
      const result = await checkDimension(redis, dim.key, dim.max, catConfig.windowMs, now);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter));
        c.header("X-RateLimit-Limit", String(dim.max));
        c.header("X-RateLimit-Remaining", "0");
        c.header("X-RateLimit-Window", String(catConfig.windowMs));
        c.header("X-RateLimit-Dimension", dim.label);
        return c.json({ error: "too many requests" }, 429);
      }
    }

    // Informational headers for a successful request
    c.header("X-RateLimit-Limit", String(catConfig.maxRequests));
    c.header("X-RateLimit-Window", String(catConfig.windowMs));

    await next();
  };
}
