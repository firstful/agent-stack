import { z } from "zod";
/**
 * Zod schema for runtime validation of Channel.
 */
export const ChannelSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(255),
    type: z.enum(["public", "private", "dm", "group", "cross_org"]),
    domainId: z.string().uuid(),
    description: z.string().nullable().default(null),
    config: z.record(z.string(), z.unknown()).default({}),
    crossOrgEnabled: z.boolean().default(false),
    smtpAddress: z.string().email(),
    createdById: z.string().uuid(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().nullable().default(null),
});
//# sourceMappingURL=channel.js.map