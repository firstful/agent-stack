/**
 * middleware.ts — Express middleware stack for auth and request-scoped identity.
 *
 * Mount order in `src/app.ts`:
 *   cors → helmet → helmet.contentSecurityPolicy → json body parse → query parse →
 *   cors-whitelist → rate-limit → auth (this file) → route handlers.
 *
 * `req.identity` is typed as `Identity | null` using a declaration merge on
 * the Express `Request` namespace so that handlers get proper type-checking
 * without importing `Identity` directly.
 */
import type { Request, Response, NextFunction } from "express";
declare module "express" {
    interface Request {
        /** The authenticated identity, set by `authMiddleware`, or null if unauthenticated. */
        identity?: {
            id: string;
            domainId: string;
            handle: string;
            type: string;
        } | null;
    }
}
/**
 * authMiddleware — extracts the identity from the session JWT or anonymous token
 * header and attaches it to `req.identity`.
 *
 * Acceptable credential sources (in priority order):
 *   1. `Authorization: Bearer <token>` header
 *   2. `x-fuse-session` header (legacy header passthrough)
 *   3. `session` cookie parsed from the HTTP request
 *
 * For WebSocket and admin routes the caller may pass a pre-parsed identity
 * object by setting `req.identity` directly before passing the request object
 * through this middleware.
 *
 * @returns 403 if the token is absent and the route requires authentication.
 *          Proceeds normally if the route is open (unauthenticated access).
 */
export declare function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void>;
/**
 * requireAuth — wraps `authMiddleware` in a 401/403 guard for routes that must
 * reject unauthenticated requests.
 */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * requireRole — restrict access to a named role within a channel.
 */
export declare function requireRole(_role: "owner" | "admin" | "member"): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=middleware.d.ts.map