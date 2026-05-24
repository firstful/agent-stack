/**
 * handlers/message-event-handlers.ts — noop stubs for message lifecycle events.
 *
 * "Skeleton-inferred intent:"
 *   - `message:created`        — stream to WS clients, update channel last_read_at, push FCM notification
 *   - `message:edited`         — emit delta event so WebSocket clients visually mark edit, append to message_audit_log
 *   - `message:deleted`        — emit tombstone event ({( id, type: "message:deleted" })} with no body), mark status = "deleted"
 *   - `message:reaction_added` — update rich_payload.reactions[].count in Postgres, push WS delta
 *   - `message:reaction_removed` — decrement or remove entry in rich_payload.reactions, push WS delta
 *   - `message:read`           — update channel_members.last_read_at, push read-receipt to WS broadcaster
 */
import { eventBus } from "../bus.js";
// ── message:created ──────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. Push `{ id, channel_id, type: "message:created" }` to db.getPool listeners (Postgres NOTIFY already does this).
 *   2. Emit this same event to the EventBus so realtime broadcast subscribers pick it up.
 *   3. If `message.crossOrg = true`, trigger the federation webhook-out dispatcher.
 *   4. If the message mentions @all or the current user, push an FCM/APNs push notification.
 */
eventBus.subscribe("message:created", (_ev) => {
    const ev = _ev;
    console.log("[message:created]", {
        type: ev.type,
        messageId: ev.message?.id,
        channelId: ev.message?.channelId,
    });
});
// ── message:edited ───────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. Fetch existing message row to compare old vs new body.
 *   2. Emit `message:edited` to the WS cluster with a `{ oldBody, newBody }` diff so clients can render it inline.
 *   3. Record the edit in `message_audit_logs` (v2 migration addition).
 *   4. Update FTS index (synchronous re-index on messages.body_fts).
 */
eventBus.subscribe("message:edited", (_ev) => {
    const ev = _ev;
    console.log("[message:edited]", {
        type: ev.type,
        messageId: ev.messageId,
        actorId: ev.actorId,
    });
});
// ── message:deleted ──────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `UPDATE messages SET status = 'deleted' WHERE id = $1`
 *   2. Emit `message:deleted` tombstone to WS cluster (body removed from client caches ~s/ms).
 *   3. If message is root of a thread, mark child messages as tombstoned too.
 *   4. If message was shared in cross-org federation, send retraction webhook.
 */
eventBus.subscribe("message:deleted", (_ev) => {
    const ev = _ev;
    console.log("[message:deleted]", {
        type: ev.type,
        channelId: ev.channelId,
        messageId: ev.messageId,
        actorId: ev.actorId,
    });
});
// ── message:reaction_added ───────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `JSONB_SET(rich_payload, '{reactions}', ...)` on the messages row.
 *   2. If `!cross_org` broadcast WS delta; if `cross_org` funnel via the federation sync queue.
 */
eventBus.subscribe("message:reaction_added", (_ev) => {
    const ev = _ev;
    console.log("[message:reaction_added]", {
        type: ev.type,
        channelId: ev.channelId,
        messageId: ev.messageId,
        identityId: ev.identityId,
        emoji: ev.emoji,
    });
});
// ── message:reaction_removed ─────────────────────────────────────────────────
eventBus.subscribe("message:reaction_removed", (_ev) => {
    const ev = _ev;
    console.log("[message:reaction_removed]", {
        type: ev.type,
        channelId: ev.channelId,
        messageId: ev.messageId,
        identityId: ev.identityId,
        emoji: ev.emoji,
    });
});
// ── message:read ─────────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `UPDATE channel_members SET last_read_at = now() WHERE channel_id = $1 AND identity_id = $2`
 *   2. WS broadcast `message:read` so the originating user's unread badges update immediately.
 *   3. If `last_read_at >= channel_last_message.created_at` mark channel as read for this user in the unread-count cache.
 */
eventBus.subscribe("message:read", (_ev) => {
    const ev = _ev;
    console.log("[message:read]", {
        type: ev.type,
        channelId: ev.channelId,
        messageId: ev.messageId,
        identityId: ev.identityId,
    });
});
//# sourceMappingURL=message-event-handlers.js.map