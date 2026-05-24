/**
 * meeting-repo.ts — data-access for meeting operations.
 */

import pg from "pg";
import type { Pool } from "pg";
import type { Meeting, MeetingState } from "../types/meeting.js";
import { MeetingRowSchema } from "./schema.js";
import { z } from "zod";

type MeetingRow = z.infer<typeof MeetingRowSchema>;

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    channelId: row.channel_id ?? null,
    createdById: row.created_by_id,
    title: row.title,
    state: row.state as MeetingState,
    scheduledAt: row.scheduled_at ?? null,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    recordingRequested: row.recording_requested,
    participants: [],
    recordings: [],
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

export async function createMeeting(
  pool: Pool,
  data: { channelId: string; createdById: string; title: string; scheduledAt?: Date | null },
): Promise<Meeting> {
  const { rows } = await pool.query<MeetingRow>(
    `INSERT INTO meetings (channel_id, created_by_id, title, state, scheduled_at)
     VALUES ($1, $2, $3, 'scheduled', $4)
     RETURNING *`,
    [data.channelId, data.createdById, data.title, data.scheduledAt ?? null],
  );
  return toMeeting(rows[0]);
}

export async function getMeetingById(
  pool: Pool,
  id: string,
): Promise<Meeting | null> {
  const { rows } = await pool.query<MeetingRow>(
    `SELECT * FROM meetings WHERE id = $1`,
    [id],
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}

export async function updateMeeting(
  pool: Pool,
  id: string,
  data: Partial<{
    state: MeetingState;
    title: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    recordingRequested: boolean;
    metadata: Record<string, unknown>;
  }>,
): Promise<Meeting | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.state !== undefined) {
    fields.push(`state = $${idx++}`);
    values.push(data.state);
  }
  if (data.title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(data.title);
  }
  if (data.scheduledAt !== undefined) {
    fields.push(`scheduled_at = $${idx++}`);
    values.push(data.scheduledAt);
  }
  if (data.startedAt !== undefined) {
    fields.push(`started_at = $${idx++}`);
    values.push(data.startedAt);
  }
  if (data.endedAt !== undefined) {
    fields.push(`ended_at = $${idx++}`);
    values.push(data.endedAt);
  }
  if (data.recordingRequested !== undefined) {
    fields.push(`recording_requested = $${idx++}`);
    values.push(data.recordingRequested);
  }
  if (data.metadata !== undefined) {
    fields.push(`metadata = $${idx++}`);
    values.push(data.metadata);
  }

  if (fields.length === 0) {
    return getMeetingById(pool, id);
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await pool.query<MeetingRow>(
    `UPDATE meetings SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ? toMeeting(rows[0]) : null;
}
