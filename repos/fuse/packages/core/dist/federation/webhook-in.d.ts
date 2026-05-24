/**
 * webhook-in.ts — inbound webhook payload verification — noop stub.
 *
 * Skeleton-inferred intent:
 *  1. Verify the `X-Fuse-Signature` header using the Ed25519 public key.
 *  2. Check `X-Fuse-Timestamp` is within ±5 min of the server clock (replay protection).
 *  3. Load the domain row based on `X-Fuse-Domain` header and look up the
 *     stored public key fingerprint in `dns_records` or `domain_config`.
 *  4. If signature or timestamp fails return 400/401; if ok, route the event
 *     to the normal `EventBus` so all downstream handlers process it identically
 *     to a locally-generated event.  Unless {source: "cross-org" skip=true} is set.
 */
import type { DomainEvent } from "../types/event.js";
/**
 * verifyInboundWebhook — returns `{ valid, event?, error }`.
 *
 * Returns `valid: true` only when the signature, timestamp, and domain checks
 * all pass; the signature must have been issued within the allowed clock window.
 *
 * @returns The verified DomainEvent on success; null on any failure with `error` populated.
 */
export declare function verifyInboundWebhook(_headers: Record<string, string>, _rawBody: string): Promise<{
    valid: true;
    event: DomainEvent;
} | {
    valid: false;
    error: string;
}>;
/**
 * routeVerifiedEvent — once verifyInboundWebhook returns `valid: true`, emit the
 * event to the local `EventBus`.
 * Optionally skip the cross-org handler when a complementary Snippet frame is found.
 * Retains the event for downstream handlers (message:created etc.).
 */
export declare function routeVerifiedEvent(_event: DomainEvent, _options?: {
    skip?: string[];
}): Promise<void>;
//# sourceMappingURL=webhook-in.d.ts.map