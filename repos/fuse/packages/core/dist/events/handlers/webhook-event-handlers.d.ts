/**
 * handlers/webhook-event-handlers.ts — noop stubs for webhook lifecycle events.
 *
 * Skeleton intent:
 *   - `webhook:delivered` — increment success counter on the endpoint, update
 *     `last_sent_at`, enqueue next delivery in the SLA window if the subscriber
 *     has subscribed to `event:*`.
 *   - `webhook:failed`     — increment retry count; if retries exhausted mark the
 *     endpoint as `active = false` and notify the domain admin.

 * Keeping this file explicit (not a catch-all) so that adding a new delivery
 * pipeline (e.g. V2 high-priority queue) is an explicit addition.
 */
export {};
//# sourceMappingURL=webhook-event-handlers.d.ts.map