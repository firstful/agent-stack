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
import { eventBus } from "../bus.js";
// ── meeting:created ──────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. POST to LiveKit `/rooms` to create an ephemeral room.
 *   2. Persist the LiveKit room ID in `meetings.metadata.livekitRoomId`.
 *   3. Post a system message `"A meeting was scheduled: <title> — <at>"` in the channel.
 *   4. Send calendar invite (ICS) to all channel members — stub until workflow service is wired.
 */
eventBus.subscribe("meeting:created", (_ev) => {
    const ev = _ev;
    console.log({ type: 'meeting:created', meetingId: ev.meetingId, actorId: ev.actorId });
    // TODO: Not implemented — create LiveKit room, post system message, send calendar invite.
});
// ── meeting:started ──────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `UPDATE meetings SET state = 'active', started_at = now() WHERE id = $1`
 *   2. Notify all participants via WS `meeting:started` event.
 *   3. Start the recording worker if recording_requested = true.
 */
eventBus.subscribe("meeting:started", (_ev) => {
    const ev = _ev;
    console.log({ type: 'meeting:started', meetingId: ev.meetingId, actorId: ev.actorId });
    // TODO: Not implemented — mark meeting as active, notify participants.
});
// ── meeting:ended ────────────────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. `UPDATE meetings SET state = 'ended', ended_at = now()`
 *   2. Close LiveKit room.
 *   3. Start processing any recordings in the recordings array (transcribe, upload).
 */
eventBus.subscribe("meeting:ended", (_ev) => {
    const ev = _ev;
    console.log({ type: 'meeting:ended', meetingId: ev.meetingId, actorId: ev.actorId });
    // TODO: Not implemented — close room, postwrap recordings.
});
// ── meeting:recording_started ─────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. Tell LiveKit to start a recording track.
 *   2. Insert `Recordings` row in Postgres.
 *   3. Broadcast `meeting:recording_started` to all participants.
 */
eventBus.subscribe("meeting:recording_started", (_ev) => {
    const ev = _ev;
    console.log({ type: 'meeting:recording_started', meetingId: ev.meetingId, actorId: ev.actorId });
    // TODO: Not implemented — instruct LiveKit to start recording.
});
// ── meeting:recording_ended ───────────────────────────────────────────────────
/**
 * Skeleton-inferred intent:
 *   1. Create MinIO S3 upload task (signed URL or direct PUT).
 *   2. Upload recording binary, mark `(has_transcript = false)` and persist storageKey.
 *   3. If ASR service configured, kick off async transcription job.
 */
eventBus.subscribe("meeting:recording_ended", (_ev) => {
    const ev = _ev;
    console.log({ type: 'meeting:recording_ended', meetingId: ev.meetingId, actorId: ev.actorId });
    // TODO: Not implemented — upload to MinIO, kick off transcription.
});
//# sourceMappingURL=meeting-event-handlers.js.map