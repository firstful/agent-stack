/**
 * handlers/meeting-event-handlers.ts — noop stubs for meeting lifecycle events.
 *
 * Skeleton intent:
 *   - `meeting:created`         — create LiveKit room; emit room metadata URL to channel as system message.
 *   - `meeting:started`         — signal LiveKit server to mark the meeting as live; update meeting.state = "active".
 *   - `meeting:ended`           — close LiveKit room; emit `"Meeting ended"` system message; finalise recordings.
 *   - `meeting:recording_started` — toggle LiveKit recording; write recording row in Postgres.
 *   - `meeting:recording_ended`   — stop LiveKit recording; upload final binary to MinIO S3 bucket.
 */
export {};
//# sourceMappingURL=meeting-event-handlers.d.ts.map