/**
 * meeting-repo.ts — data-access for meeting operations.
 */
function toMeeting(row) {
    return {
        id: row.id,
        channelId: row.channel_id ?? null,
        createdById: row.created_by_id,
        title: row.title,
        state: row.state,
        scheduledAt: row.scheduled_at ?? null,
        startedAt: row.started_at ?? null,
        endedAt: row.ended_at ?? null,
        recordingRequested: row.recording_requested,
        participants: [],
        recordings: [],
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? null,
    };
}
export async function createMeeting(pool, data) {
    const { rows } = await pool.query(`INSERT INTO meetings (channel_id, created_by_id, title, state, scheduled_at)
     VALUES ($1, $2, $3, 'scheduled', $4)
     RETURNING *`, [data.channelId, data.createdById, data.title, data.scheduledAt ?? null]);
    return toMeeting(rows[0]);
}
export async function getMeetingById(pool, id) {
    const { rows } = await pool.query(`SELECT * FROM meetings WHERE id = $1`, [id]);
    return rows[0] ? toMeeting(rows[0]) : null;
}
export async function updateMeeting(pool, id, data) {
    const fields = [];
    const values = [];
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
    const { rows } = await pool.query(`UPDATE meetings SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0] ? toMeeting(rows[0]) : null;
}
//# sourceMappingURL=meeting-repo.js.map