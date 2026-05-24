/**
 * FUSE Postgres schema — Zod validation for every table.
 *
 * The DDL is applied by src/db/migrations/001_initial.sql (unversioned here so
 * it is not published as a JS string but lives alongside the runner that uses it).
 */
import { z } from "zod";
import type { ChannelType } from "../types/channel.js";
import type { MessageStatus, MessageType } from "../types/message.js";
import type { IdentityType } from "../types/identity.js";
import type { TrustLevel } from "../types/domain.js";
import type { MeetingState } from "../types/meeting.js";
import type { BlockType } from "../types/document.js";
export declare const TrustLevelNumSchema: z.ZodNumber;
export declare function asTrustLevel(v: z.TypeOf<typeof TrustLevelNumSchema>): TrustLevel;
export declare const ChannelTypeSchema: z.ZodEnum<{
    private: "private";
    public: "public";
    dm: "dm";
    group: "group";
    cross_org: "cross_org";
}>;
export declare function asChannelType(v: z.TypeOf<typeof ChannelTypeSchema>): ChannelType;
export declare const IdentityTypeSchema: z.ZodEnum<{
    human: "human";
    agent: "agent";
    shared: "shared";
    service: "service";
    guest: "guest";
}>;
export declare function asIdentityType(v: z.TypeOf<typeof IdentityTypeSchema>): IdentityType;
export declare const MessageStatusSchema: z.ZodEnum<{
    pending: "pending";
    sent: "sent";
    delivered: "delivered";
    read: "read";
    failed: "failed";
    deleted: "deleted";
    moderated: "moderated";
}>;
export declare function asMessageStatus(v: z.TypeOf<typeof MessageStatusSchema>): MessageStatus;
export declare const MessageTypeSchema: z.ZodEnum<{
    agent: "agent";
    cross_org: "cross_org";
    user: "user";
    system: "system";
    bot: "bot";
    webhook: "webhook";
}>;
export declare function asMessageType(v: z.TypeOf<typeof MessageTypeSchema>): MessageType;
export declare const MeetingStateSchema: z.ZodEnum<{
    active: "active";
    scheduled: "scheduled";
    ringing: "ringing";
    recording: "recording";
    paused: "paused";
    ended: "ended";
    cancelled: "cancelled";
}>;
export declare function asMeetingState(v: z.TypeOf<typeof MeetingStateSchema>): MeetingState;
export declare const BlockTypeSchema: z.ZodEnum<{
    file: "file";
    paragraph: "paragraph";
    heading: "heading";
    heading2: "heading2";
    heading3: "heading3";
    bulletList: "bulletList";
    orderedList: "orderedList";
    taskList: "taskList";
    codeBlock: "codeBlock";
    blockQuote: "blockQuote";
    divider: "divider";
    image: "image";
    mention: "mention";
    channelLink: "channelLink";
    meetingNote: "meetingNote";
    adr: "adr";
    postmortem: "postmortem";
    okr: "okr";
    embed: "embed";
    reactionBar: "reactionBar";
    table: "table";
}>;
export declare function asBlockType(v: z.TypeOf<typeof BlockTypeSchema>): BlockType;
export declare const DomainRowSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    contact_email: z.ZodString;
    verified: z.ZodBoolean;
    active: z.ZodBoolean;
    trust_level: z.ZodNumber;
    config: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    created_at: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export declare const DnsRecordRowSchema: z.ZodObject<{
    id: z.ZodString;
    domain_id: z.ZodString;
    label: z.ZodString;
    rdata: z.ZodArray<z.ZodString>;
    ttl: z.ZodNumber;
}, z.core.$strip>;
export declare const IdentityRowSchema: z.ZodObject<{
    id: z.ZodString;
    domain_id: z.ZodString;
    display_name: z.ZodString;
    handle: z.ZodString;
    type: z.ZodEnum<{
        human: "human";
        agent: "agent";
        shared: "shared";
        service: "service";
        guest: "guest";
    }>;
    avatar_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    bio: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    banned: z.ZodBoolean;
    expires_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    created_at: z.ZodCoercedDate<unknown>;
    last_seen_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    opt_out_of_federation: z.ZodBoolean;
}, z.core.$strip>;
export declare const IdentityKeyRowSchema: z.ZodObject<{
    id: z.ZodString;
    identity_id: z.ZodString;
    fingerprint: z.ZodString;
    rawbytes: z.ZodString;
    created_at: z.ZodCoercedDate<unknown>;
    revoked_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    revoked: z.ZodBoolean;
}, z.core.$strip>;
export declare const ChannelRowSchema: z.ZodObject<{
    id: z.ZodString;
    domain_id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
        private: "private";
        public: "public";
        dm: "dm";
        group: "group";
        cross_org: "cross_org";
    }>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    config: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    cross_org_enabled: z.ZodBoolean;
    smtp_address: z.ZodString;
    created_by_id: z.ZodString;
    created_at: z.ZodCoercedDate<unknown>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
}, z.core.$strip>;
export declare const ChannelPermissionRowSchema: z.ZodObject<{
    channel_id: z.ZodString;
    write_members: z.ZodBoolean;
    write_guests: z.ZodBoolean;
    write_cross_org: z.ZodBoolean;
    max_attachment_bytes: z.ZodNumber;
    attachments_enabled: z.ZodBoolean;
    audit_log: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    approval_required: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const ChannelMemberRowSchema: z.ZodObject<{
    id: z.ZodString;
    channel_id: z.ZodString;
    identity_id: z.ZodString;
    member_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    role: z.ZodEnum<{
        guest: "guest";
        owner: "owner";
        admin: "admin";
        member: "member";
    }>;
    muted: z.ZodBoolean;
    hidden: z.ZodBoolean;
    last_read_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    joined_at: z.ZodCoercedDate<unknown>;
    left_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
}, z.core.$strip>;
export declare const MessageRowSchema: z.ZodObject<{
    id: z.ZodString;
    channel_id: z.ZodString;
    parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    author_id: z.ZodString;
    body: z.ZodString;
    body_html: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    rfc822_source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    rfc822_content_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thread_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    rich_payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    type: z.ZodEnum<{
        agent: "agent";
        cross_org: "cross_org";
        user: "user";
        system: "system";
        bot: "bot";
        webhook: "webhook";
    }>;
    status: z.ZodEnum<{
        pending: "pending";
        sent: "sent";
        delivered: "delivered";
        read: "read";
        failed: "failed";
        deleted: "deleted";
        moderated: "moderated";
    }>;
    smtp_message_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cross_org: z.ZodBoolean;
    created_at: z.ZodCoercedDate<unknown>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    edited_by_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const MeetingRowSchema: z.ZodObject<{
    id: z.ZodString;
    channel_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_by_id: z.ZodString;
    title: z.ZodString;
    state: z.ZodEnum<{
        active: "active";
        scheduled: "scheduled";
        ringing: "ringing";
        recording: "recording";
        paused: "paused";
        ended: "ended";
        cancelled: "cancelled";
    }>;
    scheduled_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    started_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    ended_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    recording_requested: z.ZodBoolean;
    participants: z.ZodArray<z.ZodUnknown>;
    recordings: z.ZodArray<z.ZodUnknown>;
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    created_at: z.ZodCoercedDate<unknown>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
}, z.core.$strip>;
export declare const PageRowSchema: z.ZodObject<{
    id: z.ZodString;
    channel_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_by_id: z.ZodString;
    slug: z.ZodString;
    title: z.ZodString;
    archived: z.ZodBoolean;
    locked: z.ZodBoolean;
    root_block_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    blocks: z.ZodArray<z.ZodUnknown>;
    labels: z.ZodArray<z.ZodString>;
    config: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    created_at: z.ZodCoercedDate<unknown>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
}, z.core.$strip>;
export declare const BlockRowSchema: z.ZodObject<{
    id: z.ZodString;
    page_id: z.ZodString;
    index: z.ZodNumber;
    children: z.ZodArray<z.ZodString>;
    type: z.ZodEnum<{
        file: "file";
        paragraph: "paragraph";
        heading: "heading";
        heading2: "heading2";
        heading3: "heading3";
        bulletList: "bulletList";
        orderedList: "orderedList";
        taskList: "taskList";
        codeBlock: "codeBlock";
        blockQuote: "blockQuote";
        divider: "divider";
        image: "image";
        mention: "mention";
        channelLink: "channelLink";
        meetingNote: "meetingNote";
        adr: "adr";
        postmortem: "postmortem";
        okr: "okr";
        embed: "embed";
        reactionBar: "reactionBar";
        table: "table";
    }>;
    content: z.ZodString;
    attributes: z.ZodObject<{
        caret: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            from: z.ZodNumber;
            to: z.ZodNumber;
        }, z.core.$strip>>>;
        collapsed: z.ZodOptional<z.ZodBoolean>;
        language: z.ZodOptional<z.ZodString>;
        alt: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        mentionedIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        meetingId: z.ZodOptional<z.ZodString>;
        adrStatus: z.ZodOptional<z.ZodEnum<{
            proposed: "proposed";
            accepted: "accepted";
            rejected: "rejected";
            superseded: "superseded";
        }>>;
        custom: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>;
    author_id: z.ZodString;
    created_at: z.ZodCoercedDate<unknown>;
    updated_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    deleted_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    yjs_log_hash: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const WebhookEndpointRowSchema: z.ZodObject<{
    id: z.ZodString;
    domain_id: z.ZodString;
    url: z.ZodString;
    signing_key_fingerprint: z.ZodString;
    signing_key_raw: z.ZodString;
    secret_token: z.ZodString;
    subscribed_events: z.ZodArray<z.ZodString>;
    max_retries: z.ZodNumber;
    active: z.ZodBoolean;
    last_sent_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    last_failed_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    created_at: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export declare const WebhookDeliveryRowSchema: z.ZodObject<{
    id: z.ZodString;
    endpoint_id: z.ZodString;
    event_id: z.ZodString;
    response_status: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
    latency_ms: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    signature_verified: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    success: z.ZodBoolean;
    retry_count: z.ZodNumber;
    requested_at: z.ZodCoercedDate<unknown>;
    completed_at: z.ZodOptional<z.ZodNullable<z.ZodCoercedDate<unknown>>>;
    response_body: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
//# sourceMappingURL=schema.d.ts.map