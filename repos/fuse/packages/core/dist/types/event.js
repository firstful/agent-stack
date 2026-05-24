import { z } from "zod";
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
//# sourceMappingURL=event.js.map