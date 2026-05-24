/**
 * @fuse/core — public API.
 *
 * All modules re-exported here are available to both self-hosted (`@fuse/server`)
 * and SaaS (`@fuse/cloud`) runtimes.
 */
export { config } from "./config.js";
export { createApp } from "./app.js";
export { bootstrap, gracefulShutdown } from "./bootstrap.js";
export { getPool, closePool } from "./db/pool.js";
export { createApiRouter, errorMiddleware, ApiError, typedRoute } from "./api/router.js";
export { createWsServer } from "./api/ws.js";
export { startSmtpProxy, startNotificationBridge, broadcastNewMail } from "./smtp/index.js";
export { maddyBridgeStart } from "./smtp/maddy-bridge.js";
export { createSession, verifySession } from "./auth/session.js";
export { authMiddleware, requireRole } from "./auth/middleware.js";
export { eventBus } from "./events/bus.js";
//# sourceMappingURL=index.d.ts.map