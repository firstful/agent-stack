/**
 * router.ts — Express router setup factory.
 *
 * Mounts all domain routes under `/api/v1`, wires Zod-based input validation,
 * and attaches a consistent error-handling middleware so every route can use
 * `next(err)` with a typed error extending `Error`.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
/**
 * ApiError — HTTP error with optional structured detail field.
 */
export declare class ApiError extends Error {
    status: number;
    detail?: unknown;
    constructor(status: number, message: string, detail?: unknown);
}
/**
 * typedRoute — wraps an Express route handler with schema validation.
 * On validation failure, it responds 400 immediately; on server error,
 * it passes to `next(err)`.
 */
export declare function typedRoute<T extends z.ZodType>(schema: T, handler: (ctx: {
    request: Request;
    params: unknown;
    query: unknown;
    body: unknown;
    input: z.TypeOf<T>;
    response: Response;
    next: NextFunction;
}) => Promise<void> | void): (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * errorMiddleware — converts thrown errors into JSON responses.
 *   - ApiError → its status + message
 *   - z.ZodError → 400 + detail
 *   - anything else → 500 + generic message
 */
export declare function errorMiddleware(err: Error, _req: Request, res: Response, _next: NextFunction): void;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * createApiRouter — mounts all sub-routers under `/api/v1` and adds error middleware.
 */
export declare function createApiRouter(): Router;
//# sourceMappingURL=router.d.ts.map