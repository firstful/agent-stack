/**
 * webhook-out.ts — signed webhook delivery to remote servers — noop stub.
 *
 * "Skeleton-inferred intent:"
 *   1. Sign the JSON event body with the domain's Ed25519 private key.
 *   2. POST it to the outbound webhook URL with headers:
 *        X-Fuse-Domain,   X-Fuse-Signature(base64url-encoded),  X-Fuse-Timestamp
 *   3. Record the delivery in `webhook_deliveries` with `success = true`.
 *   4. On failure, record with `success = false`, increment retry count,
 *      and push a dead-letters entry to the `fuse.outgoing_retry_queue` (v2).
 *   5. If the response body can be parsed; emit a `webhook:delivery_ack` response.
 */
import type { DomainEvent } from "../types/event.js";
import type { SignedPayload } from "../types/webhook.js";
/**
 * fireWebhook — sign and deliver a `DomainEvent` to all matching webhook
 * endpoints for the specified `domainId`.
 *
 * @param domainId   UUID of the domain the event originated from.
 * @param event      The discriminated DomainEvent to dispatch.
 * @param endpoints  Filtered list of webhook endpoints (caller applies event-wildcard match).
 * @returns          Array of `{ endpointId, success }` entries.
 */
export declare function fireWebhook(domainId: string, event: DomainEvent, _endpoints: import("../types/webhook.js").WebhookEndpoint[]): Promise<{
    endpointId: string;
    success: boolean;
}[]>;
/**
 * signEvent — produce a `SignedPayload` for an event body.
 *
 * TODO: key rotation — the signingKey version may be stored in DomainConfig
 * metadata; this stub picks the latest (version = 1) key.
 */
export declare function signEvent(_domainId: string, eventId: string, bodyObj: Record<string, unknown>, _signingKey: {
    fingerprint: string;
    rawbytes: string;
}): Promise<SignedPayload>;
//# sourceMappingURL=webhook-out.d.ts.map