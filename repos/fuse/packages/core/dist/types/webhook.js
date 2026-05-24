import { z } from "zod";
export const WebhookEndpointSchema = z.object({
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
export const WebhookDeliverySchema = z.object({
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
export const SignedPayloadSchema = z.object({
    iat: z.string().datetime(),
    domainId: z.string().uuid(),
    signature: z.string(),
    eventId: z.string().uuid(),
    body: z.string(),
});
//# sourceMappingURL=webhook.js.map