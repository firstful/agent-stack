/**
 * maddy-bridge.ts — shared Postgres schema reader.
 *
 * Listens on the Postgres `fuse_events` channel (triggered by triggers defined in
 * `src/db/migrations/001_initial.sql`) and converts filtered notifications into
 * `DomainEvent` objects emitted to the local EventBus and optionally relayed to
 * connected WebSocket clients.
 *
 * TODO: underspecified — whether Maddy delivery- and NTFY-status events also
 * flow through this bridge or a separate MTA-grade worker TBD.
 */
import { getPool } from "../db/pool.js";
import { EventTypeSchema } from "../types/event.js";
/**
 * maddyBridgeStart — attaches a raw Postgres LISTEN connection to the
 * EventBus and the WebSocket cluster.
 *
 * @param onMessage  Called whenever a new message event arrives from Postgres.
 */
export async function maddyBridgeStart(onMessage) {
    const pool = getPool();
    const client = await pool.connect();
    await client.query("LISTEN fuse_events");
    console.log("[maddy-bridge] LISTENing on fuse_events");
    client.on("notification", (msg) => {
        try {
            const parsed = JSON.parse(msg.payload ?? "{}");
            const typeResult = EventTypeSchema.safeParse(parsed.at /* placeholder */);
            // Real code would parse msg.payload as DomainEventBase — notification payload
            // only contains 'id', 'channel_id', 'type' per the trigger; the rest is
            // inferred from DB.
            if (parsed.type === "message:created") {
                onMessage(parsed);
            }
        }
        catch (err) {
            console.error("[maddy-bridge] failed to parse notification:", msg.payload, err);
        }
    });
    return () => {
        client.query("UNLISTEN fuse_events").catch(() => { });
        client.release();
        console.log("[maddy-bridge] LISTEN stopped, connection released");
    };
}
/**
 * fingerAndStore — stub called from the SMTP proxy onDATA handler to persist
 * message metadata to Postgres.
 *
 * TODO: underspecified — currently a fire-and-forget; a fully implemented version
 * would validate the RichMailRequestBody with Zod, insert the Message row, and
 * emit `message:created` to the EventBus.
 */
export async function fingerAndStore(opts) {
    const pool = getPool();
    const smtuuid = crypto.randomUUID();
    await pool.query(`INSERT INTO messages (id, channel_id, body, author_id, type, status, smtp_message_id, rich_payload, rfc822_source, rfc822_content_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'text/plain')`, [smtuuid, opts.channelId, opts.raw.slice(0, 2048), null, "user", "delivered", smtuuid, "{}", opts.raw]);
    console.log(`[maddy-bridge] fingerprinted ${smtuuid.slice(0, 8)}… into channel ${opts.channelId ?? "(none)"}`);
}
//# sourceMappingURL=maddy-bridge.js.map