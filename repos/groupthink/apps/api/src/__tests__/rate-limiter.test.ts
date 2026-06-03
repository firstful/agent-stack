import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  DEFAULT_CATEGORIES,
  categorizeRequest,
  getClientIp,
  extractGroupId,
  rateLimitMiddleware,
} from "../rate-limiter";

// ── Mock Redis ──

type RedisMock = {
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  ttl: ReturnType<typeof vi.fn>;
  [key: string]: any;
};

function createRedisMock(): RedisMock {
  return {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  };
}

// ── categorizeRequest ──

describe("categorizeRequest()", () => {
  it("returns null for health endpoint", () => {
    expect(categorizeRequest("GET", "/health")).toBeNull();
  });

  it("returns null for root path", () => {
    expect(categorizeRequest("GET", "/")).toBeNull();
  });

  it("returns 'auth' for POST /api/auth/*", () => {
    expect(categorizeRequest("POST", "/api/auth/register")).toBe("auth");
    expect(categorizeRequest("POST", "/api/auth/login")).toBe("auth");
  });

  it("returns 'read' for GET /api/auth/*", () => {
    expect(categorizeRequest("GET", "/api/auth/me")).toBe("read");
  });

  it("returns 'read' for GET requests on API paths", () => {
    expect(categorizeRequest("GET", "/api/feed")).toBe("read");
    expect(categorizeRequest("GET", "/api/groups")).toBe("read");
    expect(categorizeRequest("GET", "/api/groups/abc")).toBe("read");
    expect(categorizeRequest("HEAD", "/api/groups")).toBe("read");
    expect(categorizeRequest("OPTIONS", "/api/groups")).toBe("read");
  });

  it("returns 'write' for POST/PUT/PATCH/DELETE on API paths", () => {
    expect(categorizeRequest("POST", "/api/groups")).toBe("write");
    expect(categorizeRequest("PATCH", "/api/groups/abc/settings")).toBe("write");
    expect(categorizeRequest("PUT", "/api/groups/abc")).toBe("write");
    expect(categorizeRequest("DELETE", "/api/nicknames/123")).toBe("write");
  });
});

// ── getClientIp ──

describe("getClientIp()", () => {
  function makeContext(headers: Record<string, string>): Context {
    // Minimal Hono context mock with enough of the req interface
    return {
      req: {
        header: (name: string) => headers[name] ?? undefined,
        path: "/api/test",
        method: "GET",
      },
      // satisfy type — these aren't used by getClientIp
      set: () => {},
      get: () => undefined,
      var: {},
      event: {} as any,
      res: undefined,
      newResponse: null as any,
      body: null as any,
      text: null as any,
      json: null as any,
      html: null as any,
      redirect: null as any,
      header: null as any,
      status: null as any,
      pretty: null as any,
      notFound: null as any,
    } as unknown as Context;
  }

  it("extracts IP from x-forwarded-for (first address)", () => {
    const c = makeContext({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" });
    expect(getClientIp(c)).toBe("203.0.113.42");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const c = makeContext({ "x-real-ip": "198.51.100.7" });
    expect(getClientIp(c)).toBe("198.51.100.7");
  });

  it("returns 'unknown' when neither header is present", () => {
    const c = makeContext({});
    expect(getClientIp(c)).toBe("unknown");
  });

  it("trims whitespace from IP", () => {
    const c = makeContext({ "x-forwarded-for": "  203.0.113.42  " });
    expect(getClientIp(c)).toBe("203.0.113.42");
  });
});

// ── extractGroupId ──

describe("extractGroupId()", () => {
  it("extracts group ID from /api/groups/:id path", () => {
    expect(extractGroupId("/api/groups/abc-123")).toBe("abc-123");
  });

  it("extracts group ID from nested path", () => {
    expect(extractGroupId("/api/groups/abc-123/members")).toBe("abc-123");
    expect(extractGroupId("/api/groups/abc-123/impulses")).toBe("abc-123");
    expect(extractGroupId("/api/groups/abc-123/settings")).toBe("abc-123");
  });

  it("returns null for non-group paths", () => {
    expect(extractGroupId("/api/feed")).toBeNull();
    expect(extractGroupId("/api/auth/me")).toBeNull();
    expect(extractGroupId("/health")).toBeNull();
  });

  it("handles UUID-style group IDs", () => {
    expect(extractGroupId("/api/groups/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

// ── checkDimension (via middleware) ──

describe("rateLimitMiddleware() — dimension checks", () => {
  let redis: RedisMock;
  let app: Hono;

  beforeEach(() => {
    redis = createRedisMock();
  });

  async function callMiddleware(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    app = new Hono();
    app.use(
      "/api/*",
      rateLimitMiddleware({
        redis: redis as any,
        prefix: "test",
      }),
    );
    app.get("/api/test", (c) => c.json({ ok: true }));
    app.post("/api/test", (c) => c.json({ ok: true }));

    const res = await app.request(path, { method, headers });
    const body = await res.json().catch(() => null);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    return { status: res.status, headers: outHeaders, body };
  }

  it("allows request under the limit (first request)", { timeout: 30000 }, async () => {
    redis.incr.mockResolvedValue(1); // First request → count=1
    redis.ttl.mockResolvedValue(60);

    const result = await callMiddleware("GET", "/api/test");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    // Should have informational rate limit headers on success
    expect(Number(result.headers["x-ratelimit-limit"])).toBeGreaterThan(0);
    expect(result.headers["x-ratelimit-window"]).toBeDefined();
  });

  it("allows request when count is within limit", async () => {
    redis.incr.mockResolvedValue(30); // 30th request, limit=60
    redis.ttl.mockResolvedValue(30);

    const result = await callMiddleware("GET", "/api/test");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });

  it("rejects with 429 when count exceeds limit", async () => {
    redis.incr.mockResolvedValue(61); // 61st request, limit=60
    redis.ttl.mockResolvedValue(10);

    const result = await callMiddleware("GET", "/api/test");

    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "too many requests" });
    expect(result.headers["retry-after"]).toBeDefined();
    expect(result.headers["x-ratelimit-remaining"]).toBe("0");
    expect(result.headers["x-ratelimit-dimension"]).toBe("ip");
  });

  it("sets TTL on first request in window", async () => {
    redis.incr.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(60);

    await callMiddleware("GET", "/api/test");

    // Should have called expire with the key
    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining("rate:test"),
      60,
    );
  });

  it("does not call expire on subsequent requests", async () => {
    redis.incr.mockResolvedValue(5); // Not first
    redis.ttl.mockResolvedValue(55);

    await callMiddleware("GET", "/api/test");

    // expire should not be called for subsequent requests
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("recovers TTL safety when ttl returns -1", async () => {
    redis.incr.mockResolvedValue(5);
    redis.ttl.mockResolvedValue(-1); // Key exists but no expiry

    await callMiddleware("GET", "/api/test");

    // Should have re-set expiry as safety measure
    expect(redis.expire).toHaveBeenCalled();
  });

  it("respects skip predicate", async () => {
    app = new Hono();
    app.use(
      "/api/*",
      rateLimitMiddleware({
        redis: redis as any,
        prefix: "test",
        skip: (c) => c.req.header("x-internal") === "true",
      }),
    );
    app.get("/api/test", (c) => c.json({ ok: true }));

    const res = await app.request("/api/test", {
      method: "GET",
      headers: { "x-internal": "true" },
    });

    expect(res.status).toBe(200);
    // Redis should not have been touched
    expect(redis.incr).not.toHaveBeenCalled();
  });
});

// ── Per-dimension enforcement ──

describe("rateLimitMiddleware() — multi-dimension enforcement", () => {
  let redis: RedisMock;
  let app: Hono;

  beforeEach(() => {
    redis = createRedisMock();
    app = new Hono();
    app.use(
      "/api/*",
      rateLimitMiddleware({
        redis: redis as any,
        prefix: "test",
      }),
    );
    app.get("/api/test", (c) => c.json({ ok: true }));
    app.get("/api/groups/abc/impulses", (c) => c.json({ ok: true }));
  });

  it("checks per-user dimension when x-user-id header present", async () => {
    // Return 1 for IP check, 1 for user check
    redis.incr
      .mockResolvedValueOnce(1) // IP check
      .mockResolvedValueOnce(1); // User check
    redis.ttl.mockResolvedValue(60);

    const res = await app.request("/api/test", {
      method: "GET",
      headers: { "x-user-id": "user_42" },
    });

    expect(res.status).toBe(200);
    // Should have incremented TWO keys (ip + user)
    expect(redis.incr).toHaveBeenCalledTimes(2);
  });

  it("reports user dimension in headers when user limit hit", async () => {
    redis.incr
      .mockResolvedValueOnce(1) // IP passes
      .mockResolvedValueOnce(61); // User fails
    redis.ttl.mockResolvedValue(30);

    const res = await app.request("/api/test", {
      method: "GET",
      headers: { "x-user-id": "user_42" },
    });
    const body = await res.json().catch(() => null);

    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "too many requests" });
    expect(res.headers.get("x-ratelimit-dimension")).toBe("user");
  });

  it("checks per-group dimension for group paths", async () => {
    redis.incr
      .mockResolvedValueOnce(1) // IP
      .mockResolvedValueOnce(1) // User
      .mockResolvedValueOnce(1); // Group
    redis.ttl.mockResolvedValue(60);

    const res = await app.request("/api/groups/abc/impulses", {
      method: "GET",
      headers: { "x-user-id": "user_42" },
    });

    expect(res.status).toBe(200);
    // Should have checked all three dimensions
    expect(redis.incr).toHaveBeenCalledTimes(3);
  });

  it("reports group dimension in headers when group limit hit", async () => {
    redis.incr
      .mockResolvedValueOnce(1)  // IP passes
      .mockResolvedValueOnce(1)  // User passes
      .mockResolvedValueOnce(61); // Group fails
    redis.ttl.mockResolvedValue(10);

    const res = await app.request("/api/groups/abc/impulses", {
      method: "GET",
      headers: { "x-user-id": "user_42" },
    });
    const body = await res.json().catch(() => null);

    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "too many requests" });
    expect(res.headers.get("x-ratelimit-dimension")).toBe("group");
  });
});

// ── Per-category config ──

describe("rateLimitMiddleware() — per-category limits", () => {
  let redis: RedisMock;
  let app: Hono;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("uses auth category limits for auth endpoints", async () => {
    app = new Hono();
    app.use(
      "/api/*",
      rateLimitMiddleware({
        redis: redis as any,
        prefix: "test",
      }),
    );
    // Auth endpoint (POST /api/auth/register)
    app.post("/api/auth/register", (c) => c.json({ ok: true }));
    app.get("/api/auth/me", (c) => c.json({ ok: true }));

    // First call — auth limit is 5
    redis.incr.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(60);

    const res = await app.request("/api/auth/register", { method: "POST" });

    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-ratelimit-limit"))).toBe(5);
  });

  it("uses custom config when provided via options", async () => {
    redis.incr.mockResolvedValue(1);
    redis.ttl.mockResolvedValue(60);

    app = new Hono();
    app.use(
      "/api/*",
      rateLimitMiddleware({
        redis: redis as any,
        prefix: "test",
        config: {
          read: { windowMs: 60_000, maxRequests: 100 },
          write: { windowMs: 60_000, maxRequests: 10 },
        },
      }),
    );
    app.get("/api/groups", (c) => c.json({ ok: true }));

    const res = await app.request("/api/groups");

    expect(res.status).toBe(200);
    expect(Number(res.headers.get("x-ratelimit-limit"))).toBe(100);
  });
});

// ── DEFAULT_CATEGORIES shape ──

describe("DEFAULT_CATEGORIES", () => {
  it("has expected category keys", () => {
    expect(Object.keys(DEFAULT_CATEGORIES).sort()).toEqual(["auth", "read", "write"]);
  });

  it("each category has windowMs and maxRequests", () => {
    for (const [key, cat] of Object.entries(DEFAULT_CATEGORIES)) {
      expect(cat).toHaveProperty("windowMs");
      expect(cat).toHaveProperty("maxRequests");
      expect(typeof cat.windowMs).toBe("number");
      expect(typeof cat.maxRequests).toBe("number");
      expect(cat.windowMs).toBeGreaterThan(0);
      expect(cat.maxRequests).toBeGreaterThan(0);
    }
  });

  it("auth has the strictest limit", () => {
    const { read, write, auth } = DEFAULT_CATEGORIES;
    expect(auth.maxRequests).toBeLessThan(write.maxRequests);
    expect(auth.maxRequests).toBeLessThan(read.maxRequests);
  });

  it("read has the most generous limit", () => {
    const { read, write, auth } = DEFAULT_CATEGORIES;
    expect(read.maxRequests).toBeGreaterThan(write.maxRequests);
    expect(read.maxRequests).toBeGreaterThan(auth.maxRequests);
  });
});
