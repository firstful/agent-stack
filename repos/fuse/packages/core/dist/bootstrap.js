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
import http from "node:http";
import { createApp } from "./app.js";
import { createWsServer } from "./api/ws.js";
import { startSmtpProxy, startNotificationBridge, broadcastNewMail } from "./smtp/index.js";
import { maddyBridgeStart } from "./smtp/maddy-bridge.js";
import { getPool, closePool } from "./db/pool.js";
import { config } from "./config.js";
let httpServer = null;
let wsServer = null;
let smtpServerCloseFn = null;
let notifyBridgeCloseFn = null;
/**
 * gracefulShutdown — drain open connections then exit.
 */
export async function gracefulShutdown(signal) {
    console.log(`[fuse] Received ${signal}. Draining…`);
    if (httpServer) {
        httpServer.close();
        httpServer = null;
        console.log("[fuse] HTTP server closed.");
    }
    if (smtpServerCloseFn) {
        await smtpServerCloseFn();
        smtpServerCloseFn = null;
    }
    if (wsServer) {
        wsServer.close();
        wsServer = null;
    }
    if (notifyBridgeCloseFn) {
        await notifyBridgeCloseFn();
        notifyBridgeCloseFn = null;
    }
    await closePool();
    console.log("[fuse] Shutdown complete. Goodbye.");
}
/**
 * printBanner — pretty-start ASCII banner.
 */
function printBanner() {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   ███████╗███╗   ██╗██████╗ ██╗      ║
  ║   ██╔════╝████╗  ██║██╔════╝██║      ║
  ║   █████╗  ██╔████╗ ███║     ██║      ║
  ║   ██╔══╝  ██║╚██╔╝ ██║     ██║      ║
  ║   ██║     ██║ ╚═╝  ╚██████╗███████╗ ║
  ║   ╚═╝     ╚═╝       ╚═════╝╚══════╝ ║
  ║  SMTP-Native Chat & Federation Server ║
  ║         env=${config.NODE_ENV} domain=${config.FUSE_DOMAIN} ║
  ╚══════════════════════════════════════╝`);
}
/**
 * bootstrap — starts all subsystems and begins listening.
 */
export async function bootstrap() {
    printBanner();
    // 1. DB is initialised on first call to getPool().
    const pool = getPool();
    // 2. Run schema migration (best-effort; no-op in production).
    if (config.NODE_ENV !== "production") {
        try {
            const migration = (await import("./db/schema.js"));
            if (typeof migration.DDL === "string") {
                await pool.query(migration.DDL);
                console.log("[fuse] Schema migration applied.");
            }
        }
        catch (err) {
            console.warn("[fuse] Schema migration skipped:", err.message);
        }
    }
    // 3. Express app
    const app = createApp();
    // 4. HTTP server
    httpServer = http.createServer(app);
    // 5. WebSocket
    wsServer = createWsServer(httpServer, "/ws");
    // 6. SMTP proxy
    smtpServerCloseFn = (await startSmtpProxy());
    // 7. Maddy bridge (+ notification bridge)
    notifyBridgeCloseFn = (await startNotificationBridge());
    await maddyBridgeStart((ev) => {
        broadcastNewMail(ev);
        void import("./events/bus.js").then((m) => void m.eventBus.emit(ev));
    });
    // 8. Register event bus handlers
    await import("./events/handlers/channel-event-handlers.js");
    await import("./events/handlers/message-event-handlers.js");
    await import("./events/handlers/domain-event-handlers.js");
    await import("./events/handlers/meeting-event-handlers.js");
    await import("./events/handlers/document-event-handlers.js");
    await import("./events/handlers/webhook-event-handlers.js");
    console.log("[fuse] Event bus handlers registered.");
    // 9. Listen
    httpServer.listen(config.PORT, config.HOST, () => {
        console.log(`[fuse] HTTP  : http://${config.HOST}:${config.PORT}`);
        console.log(`[fuse] WS    : ws://${config.HOST}:${config.WS_PORT}/ws`);
        console.log(`[fuse] SMTP  : smtp://${config.HOST}:${config.SMTP_PORT} → ${config.MADDY_HOST}:${config.MADDY_SMTP_PORT}`);
    });
}
//# sourceMappingURL=bootstrap.js.map