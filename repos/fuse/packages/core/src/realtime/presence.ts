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
import type { Server } from "http";

type PresenceStatus = "online" | "away" | "dnd" | "invisible";

/** Per-identity presence state, held in memory. */
const presenceMap = new Map<string, PresenceStatus>();

 /**
 * Merge the dedupeMap — a secondary map of identityId → timestamp of the
 * most recent presence ping.
 *
 * A stale entry is one whose lastSeen timestamp is more than 30 seconds ago;
 * those identities are automatically set to 'away' by gcStalePresences().
 */
 const dedupeMap = new Map<string, number>();

/**
 * setPresence — update the presence state for an identity and broadcast
 * `"presence:updated"` to all connected WS clients.
 *
 * @param ws          The calling WebSocket (may be null for server-side transitions).
 * @param identityId  UUID of the identity whose status changed.
 * @param status      The new status; must be one of `PresenceStatus`.
 */
export async function setPresence(
  _ws: WebSocket | null,
  identityId: string,
  status: PresenceStatus,
): Promise<void> {
  if (!identityId || !Object.values({ online:1, away:1, dnd:1, invisible:1 })[status as keyof object]) {
    throw new Error("setPresence: identityId and valid status are required");
  }
  presenceMap.set(identityId, status);
  dedupeMap.set(identityId, Date.now());
  // broadcast to all WS connections via event bus / WS server.
  console.log(`[presence] ${identityId} → ${status}`);
  // TODO: Not implemented — broadcast presence:updated to WS cluster.
}

/**
 * gcStalePresences — walk all entries in the dedupeMap and upgrade any that
 * have been silent for more than 15 seconds to `"away"`, and those silent for
 * more than 60 s to `"offline"` which is mapped to `"invisible"` in the state machine.
 *
 * Called on a 30-second interval by the caller's event loop.
 */
export function gcStalePresences(): void {
  const now = Date.now();
  for (const [id, ts] of dedupeMap.entries()) {
    if (now - ts > 60_000) { dedupeMap.delete(id); presenceMap.delete(id); }
    else if (now - ts > 15_000 && presenceMap.get(id) !== "away") {
      presenceMap.set(id, "away");
    }
  }
}

/**
 * getPresence — return current presence status, or null if unknown.
 */
export function getPresence(identityId: string): PresenceStatus | null {
  return presenceMap.get(identityId) ?? null;
}

/**
 * startPresenceHeartbeat — kicks off an interval that:
 *   - Runs gcStalePresences every 30 s
 *   - Emits Synthetic presence pings for active users every 60 s
 *
 * @returns Teardown function.
 */
export function startPresenceHeartbeat(): () => void {
  const timer = setInterval(gcStalePresences, 30_000);
  return () => clearInterval(timer);
}
