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
export {};
//# sourceMappingURL=channel-event-handlers.d.ts.map