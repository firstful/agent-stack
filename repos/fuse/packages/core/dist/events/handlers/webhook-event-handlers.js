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
import { eventBus } from "../bus.js";
// ── webhook:delivered ─────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `UPDATE webhook_endpoints SET last_sent_at = now() WHERE id = $1`
 *   2. `INSERT INTO webhook_deliveries (…) VALUES (…)`
 *   3. For subscribed events of type `*`, re-emit all buffered events that were
 *      queued during the endpoint's downtime period.
 */
eventBus.subscribe("webhook:delivered", (_ev) => {
    const ev = _ev;
    console.log({ type: "webhook:delivered", endpointId: ev.endpointId, eventId: ev.eventId, deliveryId: ev.deliveryId });
});
// ── webhook:failed ─────────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. Increment `retry_count` on delivery row.
 *   2. If retry_count < max_retries, re-enqueue delivery with exponential back-off:
 *      delay_ms = base_delay * 2^(retry_count - 1) + jitter(0, base_delay * 0.2)
 *   3. If retries exhausted: set `active = false` on endpoint, push admin alert
 *      via WebSocket to admin namespace.
 */
eventBus.subscribe("webhook:failed", (_ev) => {
    const ev = _ev;
    console.log({ type: "webhook:failed", endpointId: ev.endpointId, eventId: ev.eventId, reason: ev.reason });
});
//# sourceMappingURL=webhook-event-handlers.js.map