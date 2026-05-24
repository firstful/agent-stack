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
export {};
//# sourceMappingURL=message-event-handlers.d.ts.map