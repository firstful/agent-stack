import { z } from "zod";
import type { Channel, ChannelMember } from "./channel.js";
import type { Message } from "./message.js";
import type { Identity } from "./identity.js";
import type { Domain } from "./domain.js";
import type { Meeting } from "./meeting.js";
import type { Page, Block } from "./document.js";

/** Base fields every DomainEvent carries. */
export type DomainEventBase = {
  /** RFC 3339 UTC timestamp. */
  at: string;
  /** Causation event ID (for event-sourcing; null for root events). */
  causationId: string | null;
  /** Correlation ID that ties a request / operation's events together. */
  correlationId: string | null;
};

/**
 * DomainEvent — discriminated union of every event the FUSE system emits.
 *
 * Consumers narrow with `event.type === "channel:created"` then access
 * payload typed as the matching `ChannelEvent` variant.
 */
export type DomainEvent =
  | ChannelEvent
  | MessageEvent
  | IdentityEvent
  | DomainEventVariant
  | MeetingEvent
  | DocumentEvent
  | WebhookEvent
  | PresenceEvent
  | TypingEvent;

/**
 * Discriminator values for the DomainEvent union.
 */
export type DomainEventType =
  | "channel:created"
  | "channel:updated"
  | "channel:deleted"
  | "channel:member_added"
  | "channel:member_removed"
  | "message:created"
  | "message:edited"
  | "message:deleted"
  | "message:reaction_added"
  | "message:reaction_removed"
  | "message:read"
  | "identity:created"
  | "identity:updated"
  | "identity:deleted"
  | "domain:created"
  | "domain:updated"
  | "domain:deleted"
  | "domain:trust_level_changed"
  | "meeting:created"
  | "meeting:started"
  | "meeting:ended"
  | "meeting:recording_started"
  | "meeting:recording_ended"
  | "document:created"
  | "document:updated"
  | "document:block_upserted"
  | "document:block_deleted"
  | "webhook:delivered"
  | "webhook:failed"
  | "presence:updated"
  | "typing:started"
  | "typing:stopped";

/**
 * Channel events — emitted when the channel aggregate changes.
 */
export type ChannelEvent =
  | { type: "channel:created";      channel: Channel;                     actorId: string } & DomainEventBase
  | { type: "channel:updated";      channel: Partial<Channel> & { id: string }; changes: Partial<Channel>; actorId: string } & DomainEventBase
  | { type: "channel:deleted";      channelId: string;                     actorId: string } & DomainEventBase
  | { type: "channel:member_added"; channel: Channel; member: ChannelMember; actorId: string } & DomainEventBase
  | { type: "channel:member_removed";channelId: string; memberId: string;    actorId: string } & DomainEventBase;

/**
 * Message events — emitted when a message transitions through its lifecycle.
 */
export type MessageEvent =
  | { type: "message:created";        message: Message } & DomainEventBase
  | { type: "message:edited";        messageId: string; body: string; edits: number; actorId: string } & DomainEventBase
  | { type: "message:deleted";       channelId: string; messageId: string; actorId: string } & DomainEventBase
  | { type: "message:reaction_added";channelId: string; messageId: string; identityId: string; emoji: string } & DomainEventBase
  | { type: "message:reaction_removed";channelId: string;messageId: string; identityId: string; emoji: string } & DomainEventBase
  | { type: "message:read";          channelId: string; messageId: string; identityId: string } & DomainEventBase;

/**
 * Identity events.
 */
export type IdentityEvent =
  | { type: "identity:created"; identity: Identity;               actorId: string } & DomainEventBase
  | { type: "identity:updated"; identityId: string; changes: Partial<Identity>; actorId: string } & DomainEventBase
  | { type: "identity:deleted"; identityId: string; actorId: string } & DomainEventBase;

/**
 * Domain events.
 */
export type DomainEventVariant =
  | { type: "domain:created";              domain: Domain;                   actorId: string } & DomainEventBase
  | { type: "domain:updated";              domainId: string; changes: Partial<Domain>; actorId: string } & DomainEventBase
  | { type: "domain:deleted";              domainId: string; actorId: string } & DomainEventBase
  | { type: "domain:trust_level_changed";  domainId: string; oldLevel: number; newLevel: number; actorId: string } & DomainEventBase;

/**
 * Meeting events.
 */
export type MeetingEvent =
  | { type: "meeting:created";           meeting: Meeting;           actorId: string } & DomainEventBase
  | { type: "meeting:started";           meetingId: string;         actorId: string } & DomainEventBase
  | { type: "meeting:ended";             meetingId: string; actorId: string } & DomainEventBase
  | { type: "meeting:recording_started"; meetingId: string;         recordingId: string; actorId: string } & DomainEventBase
  | { type: "meeting:recording_ended";   meetingId: string;         recordingId: string; actorId: string } & DomainEventBase;

/**
 * Document events.
 */
export type DocumentEvent =
  | { type: "document:created";      page: Page;   actorId: string } & DomainEventBase
  | { type: "document:updated";      pageId: string; changes: Partial<Page>; actorId: string } & DomainEventBase
  | { type: "document:block_upserted"; pageId: string;  block: Block; actorId: string } & DomainEventBase
  | { type: "document:block_deleted"; pageId: string;  blockId: string; actorId: string } & DomainEventBase;

/**
 * Webhook events.
 */
export type WebhookEvent =
  | { type: "webhook:delivered"; endpointId: string; eventId: string;     deliveryId: string } & DomainEventBase
  | { type: "webhook:failed";     endpointId: string; eventId: string; reason: string } & DomainEventBase;

/**
 * Realtime presence event — lightweight broadcast.
 */
export type PresenceEvent = {
  type: "presence:updated";
  identityId: string;
  status: "online" | "away" | "dnd" | "invisible";
} & DomainEventBase;

/**
 * Typing indicator event.
 */
export type TypingEvent =
  | { type: "typing:started"; channelId: string; identityId: string } & DomainEventBase
  | { type: "typing:stopped";  channelId: string; identityId: string } & DomainEventBase;

/** Zod discriminator — validates the "type" field against the full union. */
export const EventTypeSchema = z.enum([
  "channel:created",
  "channel:updated",
  "channel:deleted",
  "channel:member_added",
  "channel:member_removed",
  "message:created",
  "message:edited",
  "message:deleted",
  "message:reaction_added",
  "message:reaction_removed",
  "message:read",
  "identity:created",
  "identity:updated",
  "identity:deleted",
  "domain:created",
  "domain:updated",
  "domain:deleted",
  "domain:trust_level_changed",
  "meeting:created",
  "meeting:started",
  "meeting:ended",
  "meeting:recording_started",
  "meeting:recording_ended",
  "document:created",
  "document:updated",
  "document:block_upserted",
  "document:block_deleted",
  "webhook:delivered",
  "webhook:failed",
  "presence:updated",
  "typing:started",
  "typing:stopped",
]);

/** Base event fields. */
export const DomainEventBaseSchema = z.object({
  at: z.string().datetime(),
  causationId: z.string().uuid().nullable().default(null),
  correlationId: z.string().uuid().nullable().default(null),
});
