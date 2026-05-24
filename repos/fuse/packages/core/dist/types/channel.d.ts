import { z } from "zod";
/**
 * Channel — a conversation container within FUSE.
 *
 * @remarks
 * Channels are the fundamental unit of FUSE conversations, modelled as first-class
 * objects so that every message, membership change, and write-permission audit is
 * traceable to the channel that owns it.
 */
export type Channel = {
    /** Primary key. */
    id: string;
    /** Human-friendly name, unique within the owning domain. */
    name: string;
    /** Channel type determining visibility and access rules. */
    type: ChannelType;
    /** ID of the domain that owns this channel. */
    domainId: string;
    /** Short description; optional. */
    description: string | null;
    /** Channel configuration blob (custom emoji, pinned messages, etc.). */
    config: Record<string, unknown>;
    /** Whether the channel accepts external cross-domain federation. */
    crossOrgEnabled: boolean;
    /** Fully-qualified SMTP inbox address (e.g. #general@example.com). */
    smtpAddress: string;
    /** Who created the channel. */
    createdById: string;
    /** Created timestamp. */
    createdAt: Date;
    /** Last-modified timestamp. nil until first change. */
    updatedAt: Date | null;
};
/**
 * ChannelType — canonical channel categories used for UI routing, permission
 * evaluation, and federation policy.
 */
export type ChannelType = "public" | "private" | "dm" | "group" | "cross_org";
/**
 * Zod schema for runtime validation of Channel.
 */
export declare const ChannelSchema: z.ZodType<Channel>;
/**
 * ChannelMember — links an identity to a channel with a per-channel role.
 */
export type ChannelMember = {
    /** Composite PK: channel_id || member_id. */
    id: string;
    /** FK → channels.id. */
    channelId: string;
    /** FK → identities.id. */
    identityId: string;
    /** Human label; may differ from identity.displayName per channel scope. */
    memberName: string | null;
    /** Role within the channel. */
    role: "owner" | "admin" | "member" | "guest";
    /** Whether the member has muted the channel locally. */
    muted: boolean;
    /** Whether the member has hidden the channel. */
    hidden: boolean;
    /** Last-read message timestamp. */
    lastReadAt: Date | null;
    /** Joined timestamp. */
    joinedAt: Date;
    /** Removed timestamp; nil if still a member. */
    leftAt: Date | null;
};
/**
 * ChannelPermissions — per-channel write/publish/delete permissions.
 *
 * TODO: underspecified — implementation details will depend on how admin UI
 * surfaces granular permission toggles (mask vs role, deny, allow).
 */
export type ChannelPermissions = {
    channelId: string;
    /** Who may write messages. */
    writeMembers: boolean;
    /** Whether guests may write messages. */
    writeGuests: boolean;
    /** Whether cross-org members may post. */
    writeCrossOrg: boolean;
    /** Maximum allowed attachment size in bytes. */
    maxAttachmentBytes: number;
    /** Whether attachments are permitted by default. */
    attachmentsEnabled: boolean;
    /** Audit log entries for recent permission changes; hollow stub. */
    auditLog: unknown[];
    /** TODO: underspecified — approval workflow for guest/guest write requests. */
    approvalRequired: Record<string, unknown>;
};
//# sourceMappingURL=channel.d.ts.map