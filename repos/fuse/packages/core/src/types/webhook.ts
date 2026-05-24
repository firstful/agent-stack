import { z } from "zod";

/**
 * WebhookEndpoint — an externally registered URL that FUSE sends HTTP POST
 * events to.
 *
 * TODO: underspecified — event filtering (subscribe to only `message:created`
 * vs all events) and retry strategy are not yet locked down.
 */
export type WebhookEndpoint = {
  /** PK. */
  id: string;
  /** FK → domains.id — the domain that owns this endpoint. */
  domainId: string;
  /** Full URL the payload will be POSTed to. */
  url: string;
  /** Ed25519 public key used to verify outgoing signatures. */
  signingKeyFingerprint: string;
  /** Raw signing key (stored server-side; never returned in API responses). */
  signingKeyRaw: string;
  /** Secret HMAC token that the remote must echo back in X-Webhook-Token. */
  secretToken: string;
  /** Which event type wildcards this endpoint is subscribed to. */
  subscribedEvents: string[];
  /** Number of consecutive delivery failures before the endpoint is temporarily disabled. */
  maxRetries: number;
  /** Whether the endpoint is currently active. */
  active: boolean;
  /** The time the last successful delivery was recorded (nil if never delivered). */
  lastSentAt: Date | null;
  /** The time the last failure was recorded (nil if never failed). */
  lastFailedAt: Date | null;
  /** Created timestamp. */
  createdAt: Date;
};

/**
 * WebhookDelivery — one outbound fire-and-forget attempt.
 *
 * TODO: underspecified — delivery queue mechanism (pg-backed vs Redis) and
 * exponential-backoff policy are placeholders.
 */
export type WebhookDelivery = {
  /** PK. */
  id: string;
  /** FK → webhook_endpoints.id. */
  endpointId: string;
  /** FK → events.id — a snapshot of the event that triggered this delivery. */
  eventId: string;
  /** HTTP status returned by the remote, or the error string if delivery failed. */
  responseStatus: number | string | null;
  /** Duration of the HTTP round-trip in ms. */
  latencyMs: number | null;
  /** Whether the payload signature was verified by the recipient (audit only). */
  signatureVerified: boolean | null;
  /** Whether this delivery attempt succeeded. */
  success: boolean;
  /** Number of retries attempted so far for this event. */
  retryCount: number;
  /** When the delivery was initiated. */
  requestedAt: Date;
  /** When the delivery completed (success or hard failure). */
  completedAt: Date | null;
  /** TODO: underspecified — response body size limit / redaction policy. */
  responseBody: string | null;
};

/**
 * SignedPayload — the envelope applied to every outgoing webhook request body.
 */
export type SignedPayload = {
  /** RFC 3339 timestamp of when this payload was signed. */
  iat: string;
  /** FUSE domain ID that originated the event. */
  domainId: string;
  /** Ed25519 `sign()` signature, base64url-encoded. */
  signature: string;
  /** Event ID the payload represents. */
  eventId: string;
  /** JSON-encoded event body. */
  body: string;
};

export const WebhookEndpointSchema: z.ZodType<WebhookEndpoint> = z.object({
  id: z.string().uuid(),
  domainId: z.string().uuid(),
  url: z.string().url(),
  signingKeyFingerprint: z.string(),
  signingKeyRaw: z.string(),
  secretToken: z.string(),
  subscribedEvents: z.array(z.string()),
  maxRetries: z.number().int().positive().default(3),
  active: z.boolean().default(true),
  lastSentAt: z.coerce.date().nullable().default(null),
  lastFailedAt: z.coerce.date().nullable().default(null),
  createdAt: z.coerce.date(),
});

export const WebhookDeliverySchema: z.ZodType<WebhookDelivery> = z.object({
  id: z.string().uuid(),
  endpointId: z.string().uuid(),
  eventId: z.string().uuid(),
  responseStatus: z.union([z.number(), z.string()]).nullable().default(null),
  latencyMs: z.number().nullable().default(null),
  signatureVerified: z.boolean().nullable().default(null),
  success: z.boolean(),
  retryCount: z.number().int().nonnegative().default(0),
  requestedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().default(null),
  responseBody: z.string().nullable().default(null),
});

export const SignedPayloadSchema: z.ZodType<SignedPayload> = z.object({
  iat: z.string().datetime(),
  domainId: z.string().uuid(),
  signature: z.string(),
  eventId: z.string().uuid(),
  body: z.string(),
});
