/**
 * handlers/channel-event-handlers.ts — noop stubs for channel lifecycle events.
 *
 * "Skeleton-inferred intent:"
 *   - `channel:created`    — post-create cascade (channel_members for creator, default channel_permissions row, notify WebSocket clients)
 *   - `channel:updated`    — invalidate channel metadata caches, re-broadcast channel snapshot
 *   - `channel:deleted`    — cascade-archive all messages for the channel, clean up membership rows
 *   - `channel:member_added` — broadcast member presence, send "X joined the channel" system message
 *   - `channel:member_removed` — broadcast departure, remove member from active-presence set
 */

import type { DomainEvent } from "../../types/event.js";
import { eventBus } from "../bus.js";

// ── channel:created ──────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 * After the channel row is inserted into Postgres the following side-effects
 * should fire in order:
 *
 *   1. Insert a `channel_members` row for the actor (`role = "owner"`).
 *   2. Insert a `channel_permissions` row with defaults matching the channel type.
 *   3. Emit a `message:created` system event with the body
 *      `"Channel <name> was created"` so WebSocket clients scroll to show it cleanly.
 *   4. Broadcast a `channel:snapshot` WS event to all members of the `domain_id`.
 */
eventBus.subscribe("channel:created", (_ev: DomainEvent) => {
  const ev = _ev as any;
  console.log({type: 'channel:created', channelId: ev.channelId, actorId: ev.actorId});
  // TODO: Not implemented — implement the cascade described above.
});

// ── channel:updated ──────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 * Invalidate any in-flight cache entries for the channel (Redis hashes keyed
 * by `fuse:channel:${id}`) then add the `changes` payload to a
 * Postgres `channel_audit_logs` table (not yet defined in v1 migration).
 */
eventBus.subscribe("channel:updated", (_ev: DomainEvent) => {
  const ev = _ev as any;
  console.log({type: 'channel:updated', channelId: ev.channelId, changes: ev.changes});
  // TODO: Not implemented — invalidate cache, write audit log row.
});

// ── channel:deleted ──────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 * Archival deletion:
 *   1. `UPDATE channels SET deleted_at = now() WHERE id = $1`
 *   2. Remove all channel_members rows (left_at = now())
 *   3. Annotate every message with type = 'system' and status = 'moderated'
 *      so deleted channels remain readable (audit) but non-interactive.
 */
eventBus.subscribe("channel:deleted", (_ev: DomainEvent) => {
  const ev = _ev as any;
  console.log({type: 'channel:deleted', channelId: ev.channelId, actorId: ev.actorId});
  // TODO: Not implemented — implement delete-or-archive in transaction.
});

// ── channel:member_added ─────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 *   1. Insert `channel_members` row.
 *   2. Send DM / channel system message: "${actor.displayName} added X".
 *   3. Add member's WebSocket session to the channel's broadcast subscription set.
 */
eventBus.subscribe("channel:member_added", (_ev: DomainEvent) => {
  const ev = _ev as any;
  console.log({type: 'channel:member_added', channelId: ev.channelId, memberId: ev.memberId, actorId: ev.actorId});
  // TODO: Not implemented — insert member row and broadcast join notification.
});

// ── channel:member_removed ───────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 *   1. `UPDATE channel_members SET left_at = now() WHERE channel_id && identity_id`.
 *   2. Remove from WebSocket channel broadcast set.
 *   3. Send system message: "${actor.displayName} removed X".
 */
eventBus.subscribe("channel:member_removed", (_ev: DomainEvent) => {
  // TODO: Not implemented — mark member left and clean up WS subscription.
});
