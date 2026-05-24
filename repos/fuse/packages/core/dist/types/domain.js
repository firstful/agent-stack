import { z } from "zod";
/**
 * Zod schema for Domain.
 */
export const DomainSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255),
    contactEmail: z.string().email(),
    verified: z.boolean().default(false),
    active: z.boolean().default(true),
    trustLevel: z.union([
        z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
    ]),
    dnsRecords: z.array(z.object({
        label: z.string(),
        rdata: z.array(z.string()),
        ttl: z.number().int().positive(),
        domainId: z.string().uuid(),
    })),
    config: z.object({
        domainId: z.string().uuid(),
        federationEnabled: z.boolean().default(false),
        defaultPeerTrustLevel: z.union([
            z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
        ]),
        maxMessageSizeBytes: z.number().int().positive().default(10_485_760),
        sessionStrategy: z.enum(["cookie", "header", "jwt"]).default("cookie"),
        ssoProvider: z.string().nullable().default(null),
        displayName: z.string().max(255).default(""),
        rateLimits: z.record(z.string(), z.number()),
        messageRetention: z.enum(["retain", "purge_after_hours", "purge_immediately"])
            .default("retain"),
        metadata: z.record(z.string(), z.unknown()).default({}),
        updatedAt: z.coerce.date(),
    }),
    createdAt: z.coerce.date(),
});
//# sourceMappingURL=domain.js.map