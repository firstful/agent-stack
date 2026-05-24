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
import type { Message } from "../types/message.js";
import { z } from "zod";
/** Zod schema — the FUSE RICH_MAIL JSON body. */
declare const RichMailSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodLiteral<"1">>;
    channelId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    threadId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    authorId: z.ZodOptional<z.ZodString>;
    body: z.ZodOptional<z.ZodString>;
    bodyHtml: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    html: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    rfc822Source: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contentType: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodDefault<z.ZodArray<z.ZodString>>;
    cc: z.ZodDefault<z.ZodArray<z.ZodString>>;
    subject: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    richPayload: z.ZodDefault<z.ZodObject<{
        reactions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            emoji: z.ZodString;
            count: z.ZodNumber;
        }, z.core.$strip>>>;
        readReceipts: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
        mentions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RichMailRequestBody = z.infer<typeof RichMailSchema>;
/**
 * Parse a FUSE RICH_MAIL body.
 *
 * Accepts either:
 *  - A raw JSON string (parsed automatically)
 *  - A JS object (passed through)
 *
 * @throws {z.ZodError} If the JSON payload does not match `RichMailSchema`.
 */
export declare function richMailParse(raw: string | Record<string, unknown>): RichMailRequestBody;
/**
 * Build a JSON body ready for POSTing to a FUSE webhook endpoint.
 *
 * @param src      Either a parsed `RichMailRequestBody` or a `Message` row.
 * @returns        JSON.stringify-compatible plain object.
 */
export declare function buildRichJson(src: RichMailRequestBody | Message): Record<string, unknown>;
/**
 * rfc822FromRich — assemble an RFC 5322 message from a `RichMailRequestBody`.
 *
 * Converts RICH_MAIL JSON back to a text/plain RFC 5322 email so Maddy's
 * existing SMTP pipeline can process it unchanged.
 *
 * @param src The FUSE RICH_MAIL body to convert.
 * @returns    A fully-formed RFC 5322 message string.
 */
export declare function rfc822FromRich(src: RichMailRequestBody): string;
/**
 * maybeBuildRichReply — convenience wrapper used by the maddy-bridge when
 * replaying stored messages as webhooks.
 */
export declare function maybeBuildRichReply(logId: string, body?: string, imageUrl?: string, smtpMessageId?: string, smtpRaw?: string): {
    headers: Record<string, string>;
    body: string;
};
export {};
//# sourceMappingURL=rich-mail.d.ts.map