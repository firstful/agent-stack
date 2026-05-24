import { z } from "zod";
/**
 * Zod schema for Identity.
 */
export const IdentitySchema = z.object({
    id: z.string().uuid(),
    domainId: z.string().uuid(),
    displayName: z.string().min(1).max(255),
    handle: z.string().min(1).max(255),
    type: z.enum(["human", "agent", "shared", "service", "guest"]),
    avatarUrl: z.string().url().nullable().default(null),
    bio: z.string().nullable().default(null),
    banned: z.boolean().default(false),
    expiresAt: z.coerce.date().nullable().default(null),
    createdAt: z.coerce.date(),
    lastSeenAt: z.coerce.date().nullable().default(null),
    optOutOfFederation: z.boolean().default(false),
});
//# sourceMappingURL=identity.js.map