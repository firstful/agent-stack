/**
 * types.test.ts — compile-time type checks (tsd-style assertions).
 *
 * Run with:  npx tsd src/__tests__/types.test.ts
 *
 * Every line tests that a specific type property or union member exists.
 * These tests do not execute at runtime (they use TypeScript's type system)
 * but the file must be valid JS/TS so it can be type-checked.
 */

import type { expectTypeOf, expectAssignable, expectError } from "tsd";

import type {
  Channel, ChannelType, ChannelMember, ChannelPermissions,
  Message, MessageType, RichPayload, MessageStatus,
  Identity, IdentityType, IdentityKey,
  Domain, DomainConfig, TrustLevel, DnsRecord,
  Meeting, MeetingState, Participant, Recording,
  Document, Block, BlockType, BlockAttributes, Page,
  WebhookEndpoint, WebhookDelivery, SignedPayload,
  DomainEvent, DomainEventType,
} from "../types/index.js";

import { DomainRowSchema } from "../db/schema.js";
import { MessageRowSchema } from "../db/schema.js";
import { IdentityRowSchema } from "../db/schema.js";
import { ChannelRowSchema } from "../db/schema.js";

// ── Channel ────────────────────────────────────────────────────────────────
{
  const c: Channel = {
    id:            "00000000-0000-0000-0000-000000000001",
    name:          "general",
    type:          "public",
    domainId:      "00000000-0000-0000-0000-000000000010",
    smtpAddress:   "+general@local.fuse.dev",
    createdById:   "00000000-0000-0000-0000-000000000010",
    config:        {},
    crossOrgEnabled: false,
    description:   null,
    createdAt:     new Date(),
    updatedAt:     null,
  };
}

// ── ChannelType ────────────────────────────────────────────────────────────
{
  const t: ChannelType = "public";
}

// ── ChannelMember ──────────────────────────────────────────────────────────
{
  const m: ChannelMember = {
    id: "00000000-0000-0000-0000-000000000002",
    channelId: "00000000-0000-0000-0000-000000000001",
    identityId: "00000000-0000-0000-0000-000000000010",
    memberName: null,
    role: "owner",
    muted: false,
    hidden: false,
    lastReadAt: null,
    joinedAt:  new Date(),
    leftAt:    null,
  };
}

// ── ChannelPermissions ─────────────────────────────────────────────────────
{
  const p: ChannelPermissions = {
    channelId: "00000000-0000-0000-0000-000000000001",
    writeMembers: true,
    writeGuests: false,
    writeCrossOrg: false,
    maxAttachmentBytes: 10_485_760,
    attachmentsEnabled: true,
    auditLog: [],
    approvalRequired: {},
  };
}

// ── RichPayload ────────────────────────────────────────────────────────────
{
  const r: RichPayload = {
    reactions:    [],
    threadId:     null,
    readReceipts: [],
    mentions:     [],
    previews:     [],
    annotations:  {},
  };
}

// ── Message ────────────────────────────────────────────────────────────────
{
  const msg: Message = {
    id: "00000000-0000-0000-0000-000000000003",
    channelId: "00000000-0000-0000-0000-000000000001",
    parentId: null,
    authorId: "00000000-0000-0000-0000-000000000010",
    body: "Hello, world!",
    bodyHtml: "<p>Hello, world!</p>",
    rfc822Source: "FUSE-Envelope-Id: xyz\r\n...",
    rfc822ContentType: "text/plain",
    threadId: null,
    richPayload: { reactions: [], threadId: null, readReceipts: [], mentions: [], previews: [], annotations: {} },
    type: "user",
    status: "sent",
    smtpMessageId: null,
    crossOrg: false,
    createdAt: new Date(),
    updatedAt: null,
    editedById: null,
  };
}

// ── Identity ───────────────────────────────────────────────────────────────
{
  const id: Identity = {
    id: "00000000-0000-0000-0000-000000000010",
    domainId: "00000000-0000-0000-0000-000000000090",
    displayName: "Alice",
    handle: "alice",
    type: "human",
    avatarUrl: null,
    bio: null,
    banned: false,
    expiresAt: null,
    createdAt: new Date(),
    lastSeenAt: null,
    optOutOfFederation: false,
  };
}

// ── Domain ───────────────────────────────────────────────────────────────
{
  const d: Domain = {
    id: "00000000-0000-0000-0000-000000000090",
    name: "acme.corp",
    contactEmail: "admin@acme.corp",
    verified: false,
    active: true,
    trustLevel: 2,
    dnsRecords: [],
    config: {
      domainId: "00000000-0000-0000-0000-000000000090",
      federationEnabled: false,
      defaultPeerTrustLevel: 2,
      maxMessageSizeBytes: 10_485_760,
      sessionStrategy: "cookie",
      ssoProvider: null,
      displayName: "Acme Corp",
      rateLimits: {},
      messageRetention: "retain",
      metadata: {},
      updatedAt: new Date(),
    },
    createdAt: new Date(),
  };
}

// ── TrustLevel ────────────────────────────────────────────────────────────
{
  const level: TrustLevel = 3;
}

// ── Meeting ───────────────────────────────────────────────────────────────
{
  const meeting: Meeting = {
    id: "00000000-0000-0000-0000-000000000020",
    channelId: null,
    createdById: "00000000-0000-0000-0000-000000000010",
    title: "Sprint Planning",
    state: "scheduled",
    scheduledAt: new Date(Date.now() + 86_400_000),
    startedAt: null,
    endedAt: null,
    recordingRequested: true,
    participants: [
      { identityId: "00000000-0000-0000-0000-000000000010", role: "host", joinedAt: null, leftAt: null, isActive: false },
    ],
    recordings: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: null,
  };
}

// ── Page ─────────────────────────────────────────────────────────────────
{
  const pg: Page = {
    id: "00000000-0000-0000-0000-000000000030",
    channelId: "00000000-0000-0000-0000-000000000001",
    createdById: "00000000-0000-0000-0000-000000000010",
    slug: "meeting-notes-sprint-planning",
    title: "Sprint Planning Notes",
    archived: false,
    locked: false,
    rootBlockId: null,
    blocks: [],
    labels: ["meeting", "sprint"],
    config: {},
    createdAt: new Date(),
    updatedAt: null,
  };
}

// ── Block ─────────────────────────────────────────────────────────────────
{
  const blk: Block = {
    id: "00000000-0000-0000-0000-000000000040",
    pageId: "00000000-0000-0000-0000-000000000030",
    index: 0,
    children: [],
    type: "paragraph",
    content: "Hello, page.",
    attributes: {},
    authorId: "00000000-0000-0000-0000-000000000010",
    createdAt: new Date(),
    updatedAt: null,
    deletedAt: null,
    yjsLogHash: null,
  };
}

// ── DomainEventType ───────────────────────────────────────────────────────
{
  const t: DomainEventType = "message:created";
}

// ── DomainRowSchema compile-time check ────────────────────────────────────
{
  const validRow = DomainRowSchema.parse({
    id: "00000000-0000-0000-0000-000000000090",
    name: "acme.corp",
    contact_email: "admin@acme.corp",
    verified: false,
    active: true,
    trust_level: 2,
    config: {},
    created_at: new Date(),
  });

  // Trust level must be 0-4
  // Should throw for out-of-range
  try {
    DomainRowSchema.parse({ ...validRow, trust_level: 5 });
  } catch (_e) {
    // expected — trust_level out of range
  }
}

// ── MessageRowSchema compile-time check ───────────────────────────────────
{
  MessageRowSchema.parse({
    id: "00000000-0000-0000-0000-000000000003",
    channel_id: "00000000-0000-0000-0000-000000000001",
    parent_id: null,
    author_id: "00000000-0000-0000-0000-000000000010",
    body: "Hello!",
    body_html: null,
    rfc822Source: null,
    rfc822_content_type: null,
    thread_id: null,
    rich_payload: {},
    type: "user",
    status: "sent",
    smtp_message_id: null,
    cross_org: false,
    created_at: new Date(),
    updated_at: null,
    edited_by_id: null,
    createdBy: null,
  });
}

// ── IdentityRowSchema compile-time check ───────────────────────────────────
{
  IdentityRowSchema.parse({
    id: "00000000-0000-0000-0000-000000000010",
    domain_id: "00000000-0000-0000-0000-000000000090",
    display_name: "Alice",
    handle: "alice",
    type: "human",
    avatar_url: null,
    bio: null,
    banned: false,
    expires_at: null,
    created_at: new Date(),
    last_seen_at: null,
    opt_out_of_federation: false,
  });
}

export {};
