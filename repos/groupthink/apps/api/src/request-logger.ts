/**
 * Structured request-logging middleware for Hono.
 *
 * Logs every HTTP request as a single JSON line after the response is sent,
 * capturing method, path, status, latency, user agent, client IP, and the
 * x-user-id header for per-user observability.
 *
 * Output goes to stdout via the existing structured logger so the OTEL
 * → Quickwit pipeline picks it up automatically.
 */

import type { Context, Next } from "hono";
import { logger } from "./logger";

const requestLogger = logger.child({ component: "http" });

/**
 * Middleware that wraps the request lifecycle, measures wall-clock latency,
 * and writes a structured log entry on completion.
 *
 * Usage:
 *   app.use("*", requestLoggingMiddleware);
 */
export async function requestLoggingMiddleware(
  c: Context,
  next: Next,
): Promise<void> {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;
  const userId = c.req.header("x-user-id") ?? null;
  const userAgent = c.req.header("user-agent") ?? null;
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null;

  await next();

  const latencyMs = Math.round((performance.now() - start) * 100) / 100;
  const status = c.res.status;

  requestLogger.info(`${method} ${path} → ${status}`, {
    http: {
      method,
      path,
      status,
      latency_ms: latencyMs,
      user_agent: userAgent,
      client_ip: ip,
      user_id: userId,
    },
  });
}
