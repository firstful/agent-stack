import { z } from "zod";
/**
 * MeetingState — lifecycle states for a Meeting record.
 */
export type MeetingState = "scheduled" | "ringing" | "active" | "recording" | "paused" | "ended" | "cancelled";
/**
 * Participant — a single attendee in a Meeting.
 *
 * TODO: underspecified — whether participant is tracked per-domain or globally
 * (and whether roles extend beyond host/guest currently TBD).
 */
export type Participant = {
    /** FK → identities.id. */
    identityId: string;
    /** Determined by call creator / invite chain. */
    role: "host" | "presenter" | "guest" | "observer";
    /** Participant set at ingest time. */
    joinedAt: Date | null;
    /** When they left (nil if still connected). */
    leftAt: Date | null;
    /** Whether mic/cam is currently enabled; sub-state not yet defined. */
    isActive: boolean;
};
/**
 * Recording — media recording associated with a Meeting.
 *
 * TODO: underspecified — storage backend (MinIO S3 key, retention policy,
 * transcript support) is not yet finalised.
 */
export type Recording = {
    /** PK. */
    id: string;
    /** FK → meetings.id. */
    meetingId: string;
    /** Object-store key where the recording binary is stored. */
    storageKey: string;
    /** Approximate duration in seconds. */
    durationSeconds: number;
    /** Whether an AI-generated transcript was attached. */
    hasTranscript: boolean;
    /** Storage key of transcript JSON, if available. */
    transcriptKey: string | null;
    /** ISO-639-1 language of the recording. */
    language: string;
    /** Created timestamp (started recording). */
    createdAt: Date;
    /** Completed / failed timestamp. */
    finishedAt: Date | null;
    /** TODO: underspecified — retention / deletion policy. */
    retention: unknown;
};
/**
 * Meeting — a scheduled or active voice/video conference in FUSE.
 */
export type Meeting = {
    /** PK. */
    id: string;
    /** FK → channels.id — the channel this meeting belongs to (may be null for p2p). */
    channelId: string | null;
    /** FK → identities.id — who created / owns the meeting. */
    createdById: string;
    /** Display title. */
    title: string;
    /** Current lifecycle state. */
    state: MeetingState;
    /** When the meeting was first scheduled or started. */
    scheduledAt: Date | null;
    /** When the meeting officially started (null until first participant joins). */
    startedAt: Date | null;
    /** When the meeting ended. */
    endedAt: Date | null;
    /** Whether a recording has been requested. */
    recordingRequested: boolean;
    /** List of participants; denormalised snapshot of meeting_attendees join table. */
    participants: Participant[];
    /** Recordings associated with this meeting. */
    recordings: Recording[];
    /** Extra metadata blob (LiveKit room ID, external link, etc.). */
    metadata: Record<string, unknown>;
    /** Created timestamp. */
    createdAt: Date;
    /** Last updated timestamp. */
    updatedAt: Date | null;
};
export declare const MeetingSchema: z.ZodType<Meeting>;
//# sourceMappingURL=meeting.d.ts.map