/**
 * presence.ts — presence state machine and WebSocket broadcast.
 *
 * Five states: online | away | dnd | invisible | offline
 *
 * State transitions (valid only):
 *
 *                     ┌─────────────────────────────────────────────────┐
 *                     │                                                 │
 *                     ▼                                                 │
 *   online ──► away ──► dnd                                              │
 *     ▲         │        │                                                │
 *     │         ▼        ▼                                                │
 *     └── invisible                                                     │
 *            │      ▲                                                    │
 *     ────────────────────────────────────────────────────────►         │
 *     (explicit offline transition after 15 s of inactivity / disconnect)│
 *                                                                         │
 * History: All transitions recorded in Postgres state → later compute to PresenceSLA tables
 * Partition topic1 topic2 however, and send to mirror
 */
import { WebSocket } from "ws";
type PresenceStatus = "online" | "away" | "dnd" | "invisible";
/**
 * setPresence — update the presence state for an identity and broadcast
 * `"presence:updated"` to all connected WS clients.
 *
 * @param ws          The calling WebSocket (may be null for server-side transitions).
 * @param identityId  UUID of the identity whose status changed.
 * @param status      The new status; must be one of `PresenceStatus`.
 */
export declare function setPresence(_ws: WebSocket | null, identityId: string, status: PresenceStatus): Promise<void>;
/**
 * gcStalePresences — walk all entries in the dedupeMap and upgrade any that
 * have been silent for more than 15 seconds to `"away"`, and those silent for
 * more than 60 s to `"offline"` which is mapped to `"invisible"` in the state machine.
 *
 * Called on a 30-second interval by the caller's event loop.
 */
export declare function gcStalePresences(): void;
/**
 * getPresence — return current presence status, or null if unknown.
 */
export declare function getPresence(identityId: string): PresenceStatus | null;
/**
 * startPresenceHeartbeat — kicks off an interval that:
 *   - Runs gcStalePresences every 30 s
 *   - Emits Synthetic presence pings for active users every 60 s
 *
 * @returns Teardown function.
 */
export declare function startPresenceHeartbeat(): () => void;
export {};
//# sourceMappingURL=presence.d.ts.map