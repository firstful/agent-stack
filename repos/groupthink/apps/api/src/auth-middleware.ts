import type { Context, Next } from "hono";
import { verifyToken } from "./auth";

/**
 * Auth middleware that reads a JWT from the Authorization header
 * (Bearer <token>) and sets the `x-user-id` header on the request
 * for downstream handlers.
 *
 * Skips /health and /api/auth/* paths.
 * Falls back to the raw `x-user-id` header for backwards compatibility
 * during migration from header-based auth.
 */
export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // Skip auth routes, health check, and other public paths
    if (
      path === "/health" ||
      path.startsWith("/api/auth/") ||
      path.startsWith("/api/auth/authorize") // OAuth authorize redirects
    ) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyToken(token);

      if (!payload) {
        return c.json({ error: "invalid or expired token" }, 401);
      }

      // Set x-user-id from the verified JWT session
      c.req.raw.headers.set("x-user-id", payload.sub);
      await next();
      return;
    }

    // Backwards compatibility: if the request already has x-user-id,
    // allow it through during migration
    const existingUserId = c.req.header("x-user-id");
    if (existingUserId && existingUserId.length > 0) {
      await next();
      return;
    }

    return c.json({ error: "unauthorized" }, 401);
  };
}
