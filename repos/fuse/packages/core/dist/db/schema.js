/**
 * FUSE Postgres schema — Zod validation for every table.
 *
 * The DDL is applied by src/db/migrations/001_initial.sql (unversioned here so
 * it is not published as a JS string but lives alongside the runner that uses it).
 */
import { z } from "zod";
// ---------------------------------------------------------------------------
// Zod validation schemas — mirror every table column by name.
// ---------------------------------------------------------------------------
export const TrustLevelNumSchema = z.number().int().min(0).max(4);
export function asTrustLevel(v) {
    return v;
}
export const ChannelTypeSchema = z.enum(["public", "private", "dm", "group", "cross_org"]);
export function asChannelType(v) { return v; }
export const IdentityTypeSchema = z.enum(["human", "agent", "shared", "service", "guest"]);
export function asIdentityType(v) { return v; }
export const MessageStatusSchema = z.enum(["pending", "sent", "delivered", "read", "failed", "deleted", "moderated"]);
export function asMessageStatus(v) { return v; }
export const MessageTypeSchema = z.enum(["user", "agent", "system", "bot", "cross_org", "webhook"]);
export function asMessageType(v) { return v; }
export const MeetingStateSchema = z.enum(["scheduled", "ringing", "active", "recording", "paused", "ended", "cancelled"]);
export function asMeetingState(v) { return v; }
export const BlockTypeSchema = z.enum([
    "paragraph", "heading", "heading2", "heading3", "bulletList", "orderedList",
    "taskList", "codeBlock", "blockQuote", "divider", "image", "file", "mention",
    "channelLink", "meetingNote", "adr", "postmortem", "okr", "embed", "reactionBar", "table",
]);
export function asBlockType(v) { return v; }
// ---------------------------------------------------------------------------
// Row-level Zod schemas — used by all repository modules.
// ---------------------------------------------------------------------------
export const DomainRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    contact_email: z.string().email(),
    verified: z.boolean(),
    active: z.boolean(),
    trust_level: TrustLevelNumSchema,
    config: z.record(z.string(), z.unknown()),
    created_at: z.coerce.date(),
});
export const DnsRecordRowSchema = z.object({
    id: z.string().uuid(),
    domain_id: z.string().uuid(),
    label: z.string(),
    rdata: z.array(z.string()),
    ttl: z.number().int().positive(),
});
export const IdentityRowSchema = z.object({
    id: z.string().uuid(),
    domain_id: z.string().uuid(),
    display_name: z.string(),
    handle: z.string(),
    type: IdentityTypeSchema,
    avatar_url: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    banned: z.boolean(),
    expires_at: z.coerce.date().nullable().optional(),
    created_at: z.coerce.date(),
    last_seen_at: z.coerce.date().nullable().optional(),
    opt_out_of_federation: z.boolean(),
});
export const IdentityKeyRowSchema = z.object({
    id: z.string().uuid(),
    identity_id: z.string().uuid(),
    fingerprint: z.string(),
    rawbytes: z.string(),
    created_at: z.coerce.date(),
    revoked_at: z.coerce.date().nullable().optional(),
    revoked: z.boolean(),
});
export const ChannelRowSchema = z.object({
    id: z.string().uuid(),
    domain_id: z.string().uuid(),
    name: z.string(),
    type: ChannelTypeSchema,
    description: z.string().nullable().optional(),
    config: z.record(z.string(), z.unknown()),
    cross_org_enabled: z.boolean(),
    smtp_address: z.string(),
    created_by_id: z.string().uuid(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable().optional(),
});
export const ChannelPermissionRowSchema = z.object({
    channel_id: z.string().uuid(),
    write_members: z.boolean(),
    write_guests: z.boolean(),
    write_cross_org: z.boolean(),
    max_attachment_bytes: z.number().int().positive(),
    attachments_enabled: z.boolean(),
    audit_log: z.record(z.string(), z.unknown()),
    approval_required: z.record(z.string(), z.unknown()),
});
export const ChannelMemberRowSchema = z.object({
    id: z.string().uuid(),
    channel_id: z.string().uuid(),
    identity_id: z.string().uuid(),
    member_name: z.string().nullable().optional(),
    role: z.enum(["owner", "admin", "member", "guest"]),
    muted: z.boolean(),
    hidden: z.boolean(),
    last_read_at: z.coerce.date().nullable().optional(),
    joined_at: z.coerce.date(),
    left_at: z.coerce.date().nullable().optional(),
});
export const MessageRowSchema = z.object({
    id: z.string().uuid(),
    channel_id: z.string().uuid(),
    parent_id: z.string().uuid().nullable().optional(),
    author_id: z.string().uuid(),
    body: z.string(),
    body_html: z.string().nullable().optional(),
    rfc822_source: z.string().nullable().optional(),
    rfc822_content_type: z.string().nullable().optional(),
    thread_id: z.string().uuid().nullable().optional(),
    rich_payload: z.record(z.string(), z.unknown()),
    type: MessageTypeSchema,
    status: MessageStatusSchema,
    smtp_message_id: z.string().nullable().optional(),
    cross_org: z.boolean(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable().optional(),
    edited_by_id: z.string().uuid().nullable().optional(),
});
export const MeetingRowSchema = z.object({
    id: z.string().uuid(),
    channel_id: z.string().uuid().nullable().optional(),
    created_by_id: z.string().uuid(),
    title: z.string(),
    state: MeetingStateSchema,
    scheduled_at: z.coerce.date().nullable().optional(),
    started_at: z.coerce.date().nullable().optional(),
    ended_at: z.coerce.date().nullable().optional(),
    recording_requested: z.boolean(),
    participants: z.array(z.unknown()),
    recordings: z.array(z.unknown()),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable().optional(),
});
export const PageRowSchema = z.object({
    id: z.string().uuid(),
    channel_id: z.string().uuid().nullable().optional(),
    created_by_id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    archived: z.boolean(),
    locked: z.boolean(),
    root_block_id: z.string().uuid().nullable().optional(),
    blocks: z.array(z.unknown()),
    labels: z.array(z.string()),
    config: z.record(z.string(), z.unknown()),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable().optional(),
});
export const BlockRowSchema = z.object({
    id: z.string().uuid(),
    page_id: z.string().uuid(),
    index: z.number().int().nonnegative(),
    children: z.array(z.string().uuid()),
    type: BlockTypeSchema,
    content: z.string(),
    attributes: z.object({
        caret: z.object({ from: z.number(), to: z.number() }).nullable().optional(),
        collapsed: z.boolean().optional(),
        language: z.string().optional(),
        alt: z.string().optional(),
        url: z.string().url().optional(),
        mentionedIds: z.array(z.string().uuid()).optional(),
        meetingId: z.string().uuid().optional(),
        adrStatus: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
        custom: z.record(z.string(), z.unknown()).optional(),
    }),
    author_id: z.string().uuid(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable().optional(),
    deleted_at: z.coerce.date().nullable().optional(),
    yjs_log_hash: z.string().nullable().optional(),
});
export const WebhookEndpointRowSchema = z.object({
    id: z.string().uuid(),
    domain_id: z.string().uuid(),
    url: z.string().url(),
    signing_key_fingerprint: z.string(),
    signing_key_raw: z.string(),
    secret_token: z.string(),
    subscribed_events: z.array(z.string()),
    max_retries: z.number().int().positive(),
    active: z.boolean(),
    last_sent_at: z.coerce.date().nullable().optional(),
    last_failed_at: z.coerce.date().nullable().optional(),
    created_at: z.coerce.date(),
});
export const WebhookDeliveryRowSchema = z.object({
    id: z.string().uuid(),
    endpoint_id: z.string().uuid(),
    event_id: z.string().uuid(),
    response_status: z.union([z.number(), z.string()]).nullable().optional(),
    latency_ms: z.number().nullable().optional(),
    signature_verified: z.boolean().nullable().optional(),
    success: z.boolean(),
    retry_count: z.number().int().nonnegative(),
    requested_at: z.coerce.date(),
    completed_at: z.coerce.date().nullable().optional(),
    response_body: z.string().nullable().optional(),
});
//# sourceMappingURL=schema.js.map