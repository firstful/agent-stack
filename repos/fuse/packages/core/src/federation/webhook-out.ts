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

import type { DomainEvent, MessageEvent } from "../types/event.js";
import type { SignedPayload } from "../types/webhook.js";
import { buildRichJson } from "../smtp/rich-mail.js";
import { signEd25519 } from "../auth/e2ee.js";

const DEFAULT_TIMEOUT_MS = 10_000; // 10 s
const DEFAULT_USER_AGENT = "FUSE-Webhook/1.0";

/**
 * fireWebhook — sign and deliver a `DomainEvent` to all matching webhook
 * endpoints for the specified `domainId`.
 *
 * @param domainId   UUID of the domain the event originated from.
 * @param event      The discriminated DomainEvent to dispatch.
 * @param endpoints  Filtered list of webhook endpoints (caller applies event-wildcard match).
 * @returns          Array of `{ endpointId, success }` entries.
 */
export async function fireWebhook(
  domainId: string,
  event:     DomainEvent,
  _endpoints: import("../types/webhook.js").WebhookEndpoint[],
): Promise<{ endpointId: string; success: boolean }[]> {
  console.log("[federation:fireWebhook]", { domainId, event });
  throw new Error("Not implemented: fireWebhook — wire up HTTP POST with Ed25519 signing");
}

/**
 * signEvent — produce a `SignedPayload` for an event body.
 *
 * TODO: key rotation — the signingKey version may be stored in DomainConfig
 * metadata; this stub picks the latest (version = 1) key.
 */
export async function signEvent(
  _domainId:  string,
  eventId:    string,
  bodyObj:    Record<string, unknown>,
  _signingKey: { fingerprint: string; rawbytes: string },
): Promise<SignedPayload> {
  // TODO: Not implemented — call `signEd25519` and wrap in SignedPayload envelope.
  console.log("[federation:signEvent]", { _domainId, eventId });
  throw new Error("Not implemented: signEvent");
}

/**
 * httpPostWithRetry — low-level HTTP POST with exponential back-off retries.
 * Used internally by `fireWebhook`.
 *
 * @throws  After `maxRetries` consecutive failures with the last error.
 */
async function httpPostWithRetry(
  _url: string,
  _headers: Record<string,string>,
  _body: string,
  _maxRetries: number,
): Promise<{ status: number; body: string }> {
  throw new Error("Not implemented: httpPostWithRetry");
}
