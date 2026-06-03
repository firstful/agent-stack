/**
 * Structured request-logging middleware for Hono.
 /**
  * Request Logging Middleware for Hono
  *
  * Logs each HTTP request as a single structured JSON line after completion,
  * capturing method, path, status code, duration, and client metadata.
  * Integrates with the existing structured JSON logger, outputting to stdout
  * for the OTEL filelog receiver or log-aggregation pipeline to pick up.
  */

 import type { Context, Next } from "hono";
 import { logger } from "./logger";

 interface RequestLogMeta {
   method: string;
   path: string;
   status: number;
   durationMs: number;
   userAgent?: string;
   ip?: string;
   userId?: string;
   contentLength?: string;
 }

 /**
  * Hono middleware that logs completed requests to stdout as structured JSON.
  *
  * Usage:
  *   app.use(requestLogger());
  *   // or per-route: app.get("/api/*", requestLogger());
  */
 export function requestLogger() {
   return async (c: Context, next: Next) => {
     const start = performance.now();

     // Capture request metadata before handler runs
     const method = c.req.method;
     const path = c.req.path;
     const userAgent = c.req.header("user-agent");
     const ip =
       c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
       c.req.header("x-real-ip") ||
       "unknown";
     const userId = c.req.header("x-user-id") || undefined;

     await next();

     const durationMs = Math.round(performance.now() - start);
     const status = c.res.status;

     const meta: RequestLogMeta = {
       method,
       path,
       status,
       durationMs,
     };
     if (userAgent) meta.userAgent = userAgent;
     if (ip !== "unknown") meta.ip = ip;
     if (userId) meta.userId = userId;

     // Use the structured logger — level based on status code
     if (status >= 500) {
       logger.error(`request ${method} ${path}`, meta);
     } else if (status >= 400) {
       logger.warn(`request ${method} ${path}`, meta);
     } else {
       logger.info(`request ${method} ${path}`, meta);
     }
   };
 }

 // Alias for backward compatibility with existing imports in index.ts
 export const requestLoggingMiddleware = requestLogger();
