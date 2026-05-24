/**
 * DocumentRepository — data-access contract for page / block operations.
 */
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function toPage(row) {
    return {
        id: row.id,
        channelId: row.channel_id,
        createdById: row.created_by_id,
        slug: row.slug,
        title: row.title,
        archived: row.archived,
        locked: row.locked,
        rootBlockId: row.root_block_id,
        blocks: row.blocks,
        labels: row.labels,
        config: row.config,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function toBlock(row) {
    return {
        id: row.id,
        pageId: row.page_id,
        index: row.index,
        children: row.children,
        type: row.type,
        content: row.content,
        attributes: row.attributes,
        authorId: row.author_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        yjsLogHash: row.yjs_log_hash,
    };
}
// ---------------------------------------------------------------------------
// Concrete query functions (used by document-handler)
// ---------------------------------------------------------------------------
export async function createPage(pool, data) {
    const { rows } = await pool.query(`INSERT INTO pages (id, channel_id, created_by_id, slug, title, archived, locked, labels, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`, [
        data.id, data.channelId, data.createdById, data.slug, data.title,
        data.archived, data.locked, data.labels, data.config,
    ]);
    return toPage(rows[0]);
}
export async function getPageBySlug(pool, channelId, slug) {
    const { rows } = await pool.query(`SELECT * FROM pages WHERE channel_id = $1 AND slug = $2`, [channelId, slug]);
    return rows[0] ? toPage(rows[0]) : null;
}
export async function updatePage(pool, id, changes) {
    const fields = [];
    const values = [];
    let idx = 1;
    const fieldMap = {
        slug: "slug",
        title: "title",
        archived: "archived",
        locked: "locked",
        labels: "labels",
        config: "config",
        rootBlockId: "root_block_id",
    };
    for (const [key, col] of Object.entries(fieldMap)) {
        if (key in changes) {
            fields.push(`${col} = $${idx++}`);
            values.push(changes[key]);
        }
    }
    if (fields.length === 0) {
        const { rows } = await pool.query(`SELECT * FROM pages WHERE id = $1`, [id]);
        return rows[0] ? toPage(rows[0]) : null;
    }
    values.push(id);
    const { rows } = await pool.query(`UPDATE pages SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0] ? toPage(rows[0]) : null;
}
export async function insertBlock(pool, pageId, block) {
    const { rows } = await pool.query(`INSERT INTO blocks (id, page_id, index, children, type, content, attributes, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`, [
        block.id, block.pageId, block.index, block.children, block.type,
        block.content, block.attributes, block.authorId,
    ]);
    return toBlock(rows[0]);
}
export async function updateBlock(pool, id, changes) {
    const fields = [];
    const values = [];
    let idx = 1;
    const fieldMap = {
        content: "content",
        attributes: "attributes",
        index: "index",
        children: "children",
        type: "type",
    };
    for (const [key, col] of Object.entries(fieldMap)) {
        if (key in changes) {
            fields.push(`${col} = $${idx++}`);
            values.push(changes[key]);
        }
    }
    if (fields.length === 0) {
        const { rows } = await pool.query(`SELECT * FROM blocks WHERE id = $1`, [id]);
        return rows[0] ? toBlock(rows[0]) : null;
    }
    values.push(id);
    const { rows } = await pool.query(`UPDATE blocks SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
    return rows[0] ? toBlock(rows[0]) : null;
}
export async function deleteBlock(pool, id) {
    const { rowCount } = await pool.query(`UPDATE blocks SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return (rowCount ?? 0) > 0;
}
export async function getPageById(pool, id) {
    const { rows } = await pool.query(`SELECT * FROM pages WHERE id = $1`, [id]);
    return rows[0] ? toPage(rows[0]) : null;
}
//# sourceMappingURL=document-repo.js.map