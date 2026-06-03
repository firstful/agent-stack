/**
 * Health Check Middleware
 *
 * Provides a rich `/health` endpoint that checks connectivity to:
 *   - PostgreSQL (simple SELECT 1)
 *   - Redis (PING)
 *   - OpenTelemetry endpoint (HEAD request, non-fatal)
 *
 * Usage in index.ts:
 *   import { healthRouter } from "./health";
 *   app.route("/health", healthRouter(db, pg, redis));
 */

import { Hono } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type postgres from "postgres";
import type { RedisClientType } from "redis";
import * as schema from "@groupthink/db";
import { logger } from "./logger";

interface HealthStatus {
  ok: boolean;
  uptime: number;
  timestamp: string;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
    telemetry: { ok: boolean; error?: string };
  };
  version?: string;
}

const START_TIME = Date.now();
const APP_VERSION =
  process.env.APP_VERSION || process.env.GIT_COMMIT_HASH || "dev";

export function healthRouter(
  _db: NodePgDatabase<typeof schema>,
  pg: postgres.Sql,
  redis: RedisClientType
) {
  const router = new Hono();

  // ── Simple liveness check (no deps) ──
  router.get("/live", (c) => c.json({ ok: true }));

  // ── Readiness check (deps required) ──
  router.get("/ready", async (c) => {
    const status = await runChecks(pg, redis);
    const httpStatus = status.ok ? 200 : 503;
    return c.json(status, httpStatus);
  });

  // ── Full health check ──
  router.get("/", async (c) => {
    const status = await runChecks(pg, redis);
    const httpStatus = status.ok ? 200 : 503;

    // Log degraded health
    if (!status.ok) {
      const failing = Object.entries(status.checks)
        .filter(([, v]) => !v.ok)
        .map(([k]) => k);
      logger.warn(`health check degraded: ${failing.join(", ")}`, {
        component: "health",
        failing,
      });
    }

    return c.json(status, httpStatus);
  });

  return router;
}

async function runChecks(
  pg: postgres.Sql,
  redis: RedisClientType
): Promise<HealthStatus> {
  const checks: HealthStatus["checks"] = {
    database: { ok: false },
    redis: { ok: false },
    telemetry: { ok: true },
  };

  // ── PostgreSQL check ──
  try {
    const dbStart = performance.now();
    await pg.unsafe("SELECT 1");
    checks.database = {
      ok: true,
      latencyMs: Math.round(performance.now() - dbStart),
    };
  } catch (err) {
    checks.database = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── Redis check ──
  try {
    const redisStart = performance.now();
    const pong = await redis.ping();
    checks.redis = {
      ok: pong === "PONG",
      latencyMs: Math.round(performance.now() - redisStart),
    };
  } catch (err) {
    checks.redis = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ── Telemetry endpoint check (non-fatal — informational only) ──
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otelEndpoint) {
    try {
      const res = await fetch(`${otelEndpoint}/v1/traces`, { method: "HEAD" });
      checks.telemetry = { ok: res.ok || res.status < 500 };
    } catch {
      checks.telemetry = { ok: false, error: "unreachable" };
    }
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return {
    ok: allOk,
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    checks,
    version: APP_VERSION,
  };
}
