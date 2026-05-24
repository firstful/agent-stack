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
import type { DomainEventBase } from "../types/event.js";
/**
 * maddyBridgeStart — attaches a raw Postgres LISTEN connection to the
 * EventBus and the WebSocket cluster.
 *
 * @param onMessage  Called whenever a new message event arrives from Postgres.
 */
export declare function maddyBridgeStart(onMessage: (event: DomainEventBase & {
    type: "message:created";
}) => void): Promise<() => void>;
/**
 * fingerAndStore — stub called from the SMTP proxy onDATA handler to persist
 * message metadata to Postgres.
 *
 * TODO: underspecified — currently a fire-and-forget; a fully implemented version
 * would validate the RichMailRequestBody with Zod, insert the Message row, and
 * emit `message:created` to the EventBus.
 */
export declare function fingerAndStore(opts: {
    raw: string;
    parsed: Record<string, unknown>;
    channelId: string | null;
}): Promise<void>;
//# sourceMappingURL=maddy-bridge.d.ts.map