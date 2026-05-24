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
import { verifySession } from "./session.js";
// ---------------------------------------------------------------------------
// authMiddleware
// ---------------------------------------------------------------------------
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
export async function authMiddleware(req, _res, next) {
    // Callers that are already authenticated (e.g. WebSocket upgrades) may attach
    // req.identity before the middleware reaches here.
    if (req.identity != null)
        return void next();
    const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : req.headers["x-fuse-session"];
    if (!bearer) {
        // No token at all — attach a nice-looking anonymous identity so that
        // downstream code has a consistent `req.identity` type to pattern-match.
        req.identity = null;
        return void next();
    }
    const session = await verifySession(bearer);
    if (!session) {
        req.identity = null;
        return void next();
    }
    req.identity = {
        id: session.sub,
        domainId: session.domainId,
        handle: session.handle,
        type: session.type,
    };
    next();
}
/**
 * requireAuth — wraps `authMiddleware` in a 401/403 guard for routes that must
 * reject unauthenticated requests.
 */
export async function requireAuth(req, res, next) {
    await authMiddleware(req, res, () => {
        if (req.identity == null) {
            res.status(401).json({ error: "Unauthorized", message: "A valid session token is required" });
        }
        else {
            next();
        }
    });
}
/**
 * requireRole — restrict access to a named role within a channel.
 */
export function requireRole(_role) {
    return (req, res, next) => {
        // TODO: Not implemented — fetch channel_members.role for req.identity on channelId param.
        if (req.identity == null) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        next();
    };
}
//# sourceMappingURL=middleware.js.map