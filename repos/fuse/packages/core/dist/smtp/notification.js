/**
 * notification.ts — Postgres LISTEN/NOTIFY → WebSocket broadcast bridge.
 *
 * Bridges new-message notifications (fired by the Postgres trigger defined in
 * migrations/001_initial.sql) to the FUSE WebSocket cluster using the shared
 * broadcast helper from smtp/proxy.ts.
 */
import { broadcastNewMail, registerWsClient, unregisterWsClient } from "./proxy.js";
/**
 * startNotificationBridge — attaches a second LISTEN connection and broadcasts
 * every `message:created` notification to the WS cluster.
 *
 * @returns Teardown function.
 */
export async function startNotificationBridge() {
    const pool = (await import("../db/pool.js")).getPool();
    const client = await pool.connect();
    await client.query("LISTEN fuse_events");
    console.log("[notification] LISTENing on fuse_events");
    client.on("notification", (msg) => {
        try {
            const payload = JSON.parse(msg.payload ?? "{}");
            if (payload.type === "message:created") {
                broadcastNewMail(payload);
            }
        }
        catch (err) {
            console.error("[notification] invalid notification payload:", msg.payload, err);
        }
    });
    // Forward ws register / unregister calls from the ws module.
    // In the real app ws passes its own functions explicitly; this is a noop stub.
    return () => {
        client.query("UNLISTEN fuse_events").catch(() => { });
        client.release();
        console.log("[notification] LISTEN stopped");
    };
}
/**
 * onWsOpen — register a new WebSocket connection for broadcast targeting.
 */
export function onWsOpen(ws) {
    registerWsClient(ws);
}
/**
 * onWsClose — unregister a WebSocket connection when it closes.
 */
export function onWsClose(ws) {
    unregisterWsClient(ws);
}
//# sourceMappingURL=notification.js.map