import { z } from "zod";
/**
 * RichPayload — the extended envelope stored alongside every Message row.
 *
 * Allows reactions, threads, and read receipts without a separate join-table
 * avalanche; the payload is stored as JSONB for flexibility.
 */
export type RichPayload = {
    /** Ordered array of emoji reactions. */
    reactions: Reaction[];
    /** If set, this message belongs to a reply thread. */
    threadId: string | null;
    /** Tracks which members have read this message and when. */
    readReceipts: ReadReceipt[];
    /** Optional @mentions for push notification targeting. */
    mentions: string[];
    /** Optional link / attachment previews generated server-side. */
    previews: unknown[];
    /** Custom client-side annotations (edited flag, pinned flag, etc.). */
    annotations: Record<string, unknown>;
};
/**
 * Reaction — a single emoji reaction from one identity on one message.
 */
export type Reaction = {
    identityId: string;
    emoji: string;
    /** Who created this reaction row (may differ from identityId after migrations). */
    createdAt: Date;
};
/**
 * ReadReceipt — a single read-event for a specific message by a specific identity.
 */
export type ReadReceipt = {
    identityId: string;
    /** UTC timestamp of when the receiver scrolled past the message. */
    readAt: Date;
};
/**
 * MessageType — how a message was injected into FUSE.
 */
export type MessageType = "user" | "agent" | "system" | "bot" | "cross_org" | "webhook";
/**
 * MessageStatus — delivery / ingest state machine.
 */
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed" | "deleted" | "moderated";
/**
 * The canonical Message record stored in Postgres.
 */
export type Message = {
    /** Primary UUID key. */
    id: string;
    /** FK → channels.id — the channel that owns this message. */
    channelId: string;
    /** FK → messages.id — the parent message if this is a reply. */
    parentId: string | null;
    /** FK → identities.id — the author. */
    authorId: string;
    /** Plain-text body used for search indexing. */
    body: string;
    /** Rich HTML / markdown representation. */
    bodyHtml: string | null;
    /** RFC 5322 source if the message arrived via SMTP. */
    rfc822Source: string | null;
    /** MIME Content-Type reported by the SMTP receiving MTA. */
    rfc822ContentType: string | null;
    /** Linked threading root. */
    threadId: string | null;
    /** Extra fields: reactions, read-receipts, etc. */
    richPayload: RichPayload;
    /** Message type discriminator. */
    type: MessageType;
    /** Delivery state. */
    status: MessageStatus;
    /** SMTP Message-ID (as assigned by Maddy or the originating MTA). */
    smtpMessageId: string | null;
    /** Whether this message was accepted across a federation boundary. */
    crossOrg: boolean;
    /** When FUSE first accepted the message. */
    createdAt: Date;
    /** Last update (status change, edit, etc.). */
    updatedAt: Date | null;
    /** Who or what last edited the message. */
    editedById: string | null;
};
/**
 * Zod schema for Message — used by all request-validation layers.
 */
export declare const MessageSchema: z.ZodType<Message>;
//# sourceMappingURL=message.d.ts.map