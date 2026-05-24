import { MessageRowSchema } from "./schema.js";
function toMessage(row) {
    return {
        id: row.id,
        channelId: row.channel_id,
        parentId: row.parent_id ?? null,
        authorId: row.author_id,
        body: row.body,
        bodyHtml: row.body_html ?? null,
        rfc822Source: row.rfc822_source ?? null,
        rfc822ContentType: row.rfc822_content_type ?? null,
        threadId: row.thread_id ?? null,
        richPayload: row.rich_payload,
        type: row.type,
        status: row.status,
        smtpMessageId: row.smtp_message_id ?? null,
        crossOrg: row.cross_org,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? null,
        editedById: row.edited_by_id ?? null,
    };
}
export async function createMessage(pool, data) {
    const { rows } = await pool.query(`
    INSERT INTO messages (
      channel_id, parent_id, author_id, body, body_html,
      rfc822_source, rfc822_content_type, thread_id, rich_payload,
      type, status, smtp_message_id, cross_org
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
    `, [
        data.channelId,
        data.parentId ?? null,
        data.authorId,
        data.body,
        data.bodyHtml ?? null,
        data.rfc822Source ?? null,
        data.rfc822ContentType ?? null,
        data.threadId ?? null,
        data.richPayload ?? {},
        data.type ?? "user",
        data.status ?? "sent",
        data.smtpMessageId ?? null,
        data.crossOrg ?? false,
    ]);
    MessageRowSchema.parse(rows[0]);
    return toMessage(rows[0]);
}
export async function getMessageById(pool, id) {
    const { rows } = await pool.query("SELECT * FROM messages WHERE id = $1", [id]);
    if (!rows[0])
        return null;
    MessageRowSchema.parse(rows[0]);
    return toMessage(rows[0]);
}
export async function listMessagesByChannel(pool, channelId, opts) {
    const limit = opts?.limit ?? 50;
    if (opts?.cursor) {
        const { rows } = await pool.query(`SELECT * FROM messages WHERE channel_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3`, [channelId, opts.cursor, limit]);
        return rows.map((r) => {
            MessageRowSchema.parse(r);
            return toMessage(r);
        });
    }
    const { rows } = await pool.query(`SELECT * FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2`, [channelId, limit]);
    return rows.map((r) => {
        MessageRowSchema.parse(r);
        return toMessage(r);
    });
}
export async function updateMessage(pool, id, data) {
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.body !== undefined) {
        fields.push(`body = $${idx++}`);
        values.push(data.body);
    }
    if (data.bodyHtml !== undefined) {
        fields.push(`body_html = $${idx++}`);
        values.push(data.bodyHtml);
    }
    if (data.status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(data.status);
    }
    if (data.richPayload !== undefined) {
        fields.push(`rich_payload = $${idx++}`);
        values.push(data.richPayload);
    }
    if (data.editedById !== undefined) {
        fields.push(`edited_by_id = $${idx++}`);
        values.push(data.editedById);
    }
    if (fields.length === 0) {
        return getMessageById(pool, id);
    }
    values.push(id);
    const { rows } = await pool.query(`UPDATE messages SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    if (!rows[0])
        return null;
    MessageRowSchema.parse(rows[0]);
    return toMessage(rows[0]);
}
export async function deleteMessage(pool, id) {
    const { rowCount } = await pool.query(`DELETE FROM messages WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
}
export async function searchMessages(pool, channelId, query) {
    const { rows } = await pool.query(`SELECT * FROM messages WHERE channel_id = $1 AND body ILIKE $2 ORDER BY created_at DESC`, [channelId, `%${query}%`]);
    return rows.map((r) => {
        MessageRowSchema.parse(r);
        return toMessage(r);
    });
}
//# sourceMappingURL=message-repo.js.map