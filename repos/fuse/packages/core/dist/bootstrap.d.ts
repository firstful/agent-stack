/**
 * bootstrap.ts — shared startup sequence.
 *
 * Initialises all subsystems in the correct dependency order.  Both
 * `@fuse/server` (self-hosted) and `@fuse/cloud` (SaaS) call this after
 * setting up their own tenancy layer.
 *
 * Bootstrap order:
 *   1. Parse env config (config.ts)
 *   2. Connect to Postgres (db/pool.ts)
 *   3. Run async Postgres migrations
 *   4. Create the Express app (app.ts) and mount middlewares
 *   5. Start the HTTP server
 *   6. Attach the WebSocket server (api/ws.ts)
 *   7. Start the SMTP proxy (smtp/proxy.ts)
 *   8. Start the notification bridge (smtp/notification.ts)
 *   9. Register EventBus handlers (events/handlers/)
 */
/**
 * gracefulShutdown — drain open connections then exit.
 */
export declare function gracefulShutdown(signal: string): Promise<void>;
/**
 * bootstrap — starts all subsystems and begins listening.
 */
export declare function bootstrap(): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map