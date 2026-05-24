import { z } from "zod";
/**
 * Zod schema for Message — used by all request-validation layers.
 */
export const MessageSchema = z.object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    parentId: z.string().uuid().nullable().default(null),
    authorId: z.string().uuid(),
    body: z.string().min(1).max(65535),
    bodyHtml: z.string().nullable().default(null),
    rfc822Source: z.string().nullable().default(null),
    rfc822ContentType: z.string().nullable().default(null),
    threadId: z.string().uuid().nullable().default(null),
    richPayload: z.object({
        threadId: z.string().nullable().default(null),
        reactions: z.array(z.object({
            identityId: z.string().uuid(),
            emoji: z.string().min(1).max(32),
            createdAt: z.coerce.date(),
        })),
        readReceipts: z.array(z.object({
            identityId: z.string().uuid(),
            readAt: z.coerce.date(),
        })),
        mentions: z.array(z.string()),
        previews: z.array(z.unknown()),
        annotations: z.record(z.string(), z.unknown()),
    }).default({
        threadId: null, reactions: [], readReceipts: [], mentions: [], previews: [], annotations: {},
    }),
    type: z.enum(["user", "agent", "system", "bot", "cross_org", "webhook"]),
    status: z.enum(["pending", "sent", "delivered", "read", "failed", "deleted", "moderated"]),
    smtpMessageId: z.string().nullable().default(null),
    crossOrg: z.boolean().default(false),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().nullable().default(null),
    editedById: z.string().uuid().nullable().default(null),
});
//# sourceMappingURL=message.js.map