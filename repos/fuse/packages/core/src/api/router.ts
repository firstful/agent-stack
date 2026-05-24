/**
 * router.ts — Express router setup factory.
 *
 * Mounts all domain routes under `/api/v1`, wires Zod-based input validation,
 * and attaches a consistent error-handling middleware so every route can use
 * `next(err)` with a typed error extending `Error`.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * ApiError — HTTP error with optional structured detail field.
 */
export class ApiError extends Error {
  status: number;
  detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
    Error.captureStackTrace?.(this, ApiError);
  }
}

// ---------------------------------------------------------------------------
// Zod request shape helpers
// ---------------------------------------------------------------------------

type RequestHandler<TInput extends z.ZodType<any, any, any>> = {
  request: Request;
  params: unknown;
  query: unknown;
  body: unknown;
  input: z.TypeOf<TInput>;
  response: Response;
  next: NextFunction;
};

/**
 * typedRoute — wraps an Express route handler with schema validation.
 * On validation failure, it responds 400 immediately; on server error,
 * it passes to `next(err)`.
 */
export function typedRoute<T extends z.ZodType>(
  schema: T,
  handler: (ctx: { request: Request; params: unknown; query: unknown; body: unknown; input: z.TypeOf<T>; response: Response; next: NextFunction }) => Promise<void> | void,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = schema.safeParse({ params: req.params, query: req.query, body: req.body });
      if (!result.success) {
        res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
        return;
      }
      await handler({ request: req, params: req.params, query: req.query, body: req.body, input: result.data, response: res, next });
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Error middleware
// ---------------------------------------------------------------------------

/**
 * errorMiddleware — converts thrown errors into JSON responses.
 *   - ApiError → its status + message
 *   - z.ZodError → 400 + detail
 *   - anything else → 500 + generic message
 */
export function errorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
}

// ---------------------------------------------------------------------------
// Pagination query schema
// ---------------------------------------------------------------------------

export const PaginationSchema = z.object({
  limit:  z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// createApiRouter — factory that builds the top-level `/api/v1` router and
// registers all domain sub-routes.
// ---------------------------------------------------------------------------

import { mountChannelRoutes } from "./channel-handler.js";
import { mountMessageRoutes } from "./message-handler.js";
import { mountIdentityRoutes } from "./identity-handler.js";
import { mountDomainRoutes } from "./domain-handler.js";
import { mountMeetingRoutes } from "./meeting-handler.js";
import { mountDocumentRoutes } from "./document-handler.js";
import { mountWebhookRoutes } from "./webhook-handler.js";
import { mountAdminRoutes } from "./admin-handler.js";

/**
 * createApiRouter — mounts all sub-routers under `/api/v1` and adds error middleware.
 */
export function createApiRouter(): Router {
  const api = Router();
  mountChannelRoutes(api);
  mountMessageRoutes(api);
  mountIdentityRoutes(api);
  mountDomainRoutes(api);
  mountMeetingRoutes(api);
  mountDocumentRoutes(api);
  mountWebhookRoutes(api);
  mountAdminRoutes(api);
  api.use(errorMiddleware);
  return api;
}
