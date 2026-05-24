/**
 * rich-mail.ts — RICH_MAIL payload parser and builder.
 *
 * RICH_MAIL is the FUSE custom extension announced in EHLO.  It allows a client
 * to POST the full message body as a JSON object rather than a contorted
 * RFC 5322 blob, then converts it back to RFC 5322 so that Maddy can still
 * process it using its normal mail pipeline.
 *
 * TODO: underspecified — the exact JSON field names and content-transfer-
 * encoding negotiation are not yet locked down; this implementation uses a
 * stable draft schema that is easy to evolve.
 */
import { z } from "zod";
/** Zod schema — the FUSE RICH_MAIL JSON body. */
const RichMailSchema = z.object({
    version: z.literal("1").default("1"),
    channelId: z.string().uuid().optional().nullable(),
    threadId: z.string().uuid().optional().nullable(),
    authorId: z.string().uuid().optional(),
    body: z.string().min(1).max(65_535).optional(),
    bodyHtml: z.string().optional().nullable(),
    html: z.string().optional().nullable(), // alias for bodyHtml
    rfc822Source: z.string().optional().nullable(),
    contentType: z.string().optional().default("text/plain"),
    from: z.string().email().optional(),
    to: z.array(z.string().email()).default([]),
    cc: z.array(z.string().email()).default([]),
    subject: z.string().optional().nullable(),
    richPayload: z.object({
        reactions: z.array(z.object({ emoji: z.string(), count: z.number().int().min(1) })).default([]),
        readReceipts: z.array(z.unknown()).default([]),
        mentions: z.array(z.string()).default([]),
    }).default({ reactions: [], readReceipts: [], mentions: [] }),
});
/**
 * Parse a FUSE RICH_MAIL body.
 *
 * Accepts either:
 *  - A raw JSON string (parsed automatically)
 *  - A JS object (passed through)
 *
 * @throws {z.ZodError} If the JSON payload does not match `RichMailSchema`.
 */
export function richMailParse(raw) {
    const input = typeof raw === "string" ? safeJsonParse(raw) : raw;
    return RichMailSchema.parse(input);
}
function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return {};
    }
}
/**
 * Build a JSON body ready for POSTing to a FUSE webhook endpoint.
 *
 * @param src      Either a parsed `RichMailRequestBody` or a `Message` row.
 * @returns        JSON.stringify-compatible plain object.
 */
export function buildRichJson(src) {
    if ("id" in src && "channelId" in src) {
        // Message row — wire in richPayload.
        const m = src;
        return {
            type: "message",
            messageId: m.id,
            channelId: m.channelId,
            threadId: m.threadId ?? null,
            authorId: m.authorId,
            body: m.body,
            bodyHtml: m.bodyHtml ?? null,
            richPayload: m.richPayload,
            smtpMessageId: m.smtpMessageId ?? null,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
        };
    }
    const r = src;
    return {
        type: "rich_mail",
        from: r.from,
        to: r.to,
        cc: r.cc,
        subject: r.subject,
        channelId: r.channelId,
        threadId: r.threadId,
        authorId: r.authorId,
        body: r.body,
        bodyHtml: r.bodyHtml ?? r.html ?? null,
        richPayload: r.richPayload,
        rfc822Source: r.rfc822Source,
    };
}
/**
 * rfc822FromRich — assemble an RFC 5322 message from a `RichMailRequestBody`.
 *
 * Converts RICH_MAIL JSON back to a text/plain RFC 5322 email so Maddy's
 * existing SMTP pipeline can process it unchanged.
 *
 * @param src The FUSE RICH_MAIL body to convert.
 * @returns    A fully-formed RFC 5322 message string.
 */
export function rfc822FromRich(src) {
    const lines = [];
    lines.push(`From: ${src.from ?? "unknown"}`);
    if (src.subject ?? null)
        lines.push(`Subject: ${src.subject}`);
    if (src.to.length > 0)
        lines.push(`To: ${src.to.join(", ")}`);
    if (src.cc.length > 0)
        lines.push(`Cc: ${src.cc.join(", ")}`);
    lines.push(`Content-Type: ${src.contentType}; charset=utf-8`);
    lines.push('');
    // TODO: underspecified — whether to HTML-multipart the body given bodyHtml.
    lines.push(src.body ?? "(empty message)");
    return lines.join("\r\n") + "\r\n";
}
/**
 * maybeBuildRichReply — convenience wrapper used by the maddy-bridge when
 * replaying stored messages as webhooks.
 */
export function maybeBuildRichReply(logId, body, imageUrl, smtpMessageId, smtpRaw) {
    if (smtpRaw)
        return { headers: { "Content-Type": "message/rfc822" }, body: smtpRaw };
    const headers = {
        "Content-Type": "application/vnd.fuse.rich-mail+json",
        "Fuse-Message-Id": logId,
    };
    if (imageUrl) {
        headers["Fuse-Image-Url"] = imageUrl;
    }
    return { headers, body: body ?? "" };
}
//# sourceMappingURL=rich-mail.js.map