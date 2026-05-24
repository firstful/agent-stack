/**
 * DocumentRepository — data-access contract for page / block operations.
 */

import type { Pool } from "pg";
import type { Block, Page, BlockAttributes } from "../types/document.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toPage(row: Record<string, unknown>): Page {
  return {
    id: row.id as string,
    channelId: row.channel_id as string | null,
    createdById: row.created_by_id as string,
    slug: row.slug as string,
    title: row.title as string,
    archived: row.archived as boolean,
    locked: row.locked as boolean,
    rootBlockId: row.root_block_id as string | null,
    blocks: row.blocks as Block[],
    labels: row.labels as string[],
    config: row.config as Record<string, unknown>,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date | null,
  };
}

function toBlock(row: Record<string, unknown>): Block {
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    index: row.index as number,
    children: row.children as string[],
    type: row.type as Block["type"],
    content: row.content as string,
    attributes: row.attributes as BlockAttributes,
    authorId: row.author_id as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date | null,
    deletedAt: row.deleted_at as Date | null,
    yjsLogHash: row.yjs_log_hash as string | null,
  };
}

// ---------------------------------------------------------------------------
// DocumentRepository interface
// ---------------------------------------------------------------------------

export interface DocumentRepository {
  // ── Page ─────────────────────────────────────────────────────────────────

  /** Create a page. */
  createPage(page: Page): Promise<Page>;
  /** Fetch a page by ID. */
  getPageById(id: string): Promise<Page | null>;
  /** Fetch a page by slug within a channel. */
  getPageBySlug(channelId: string, slug: string): Promise<Page | null>;
  /** List pages for a channel. */
  listPagesByChannel(channelId: string): Promise<Page[]>;
  /** Update page-level fields. */
  updatePage(id: string, changes: Partial<Page>): Promise<Page | null>;
  /** Archive / un-archive a page. */
  setArchived(id: string, archived: boolean): Promise<boolean>;

  // ── Block ────────────────────────────────────────────────────────────────

  /** Insert a block into a page at a given index. */
  insertBlock(pageId: string, block: Block): Promise<Block>;
  /** Update a block's content / attributes. */
  updateBlock(id: string, changes: Partial<Block>): Promise<Block | null>;
  /** Soft-delete a block. */
  deleteBlock(id: string): Promise<boolean>;
  /** Fetch all active (non-deleted) blocks for a page. */
  listActiveBlocks(pageId: string): Promise<Block[]>;
  /** Update the block tree ordering (re-insert at new index). */
  reorderBlock(blockId: string, newIndex: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Concrete query functions (used by document-handler)
// ---------------------------------------------------------------------------

export async function createPage(
  pool: Pool,
  data: Page,
): Promise<Page> {
  const { rows } = await pool.query(
    `INSERT INTO pages (id, channel_id, created_by_id, slug, title, archived, locked, labels, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.id, data.channelId, data.createdById, data.slug, data.title,
      data.archived, data.locked, data.labels, data.config,
    ],
  );
  return toPage(rows[0]);
}

export async function getPageBySlug(
  pool: Pool,
  channelId: string,
  slug: string,
): Promise<Page | null> {
  const { rows } = await pool.query(
    `SELECT * FROM pages WHERE channel_id = $1 AND slug = $2`,
    [channelId, slug],
  );
  return rows[0] ? toPage(rows[0]) : null;
}

export async function updatePage(
  pool: Pool,
  id: string,
  changes: Partial<Page>,
): Promise<Page | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
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
      values.push((changes as Record<string, unknown>)[key]);
    }
  }

  if (fields.length === 0) {
    const { rows } = await pool.query(`SELECT * FROM pages WHERE id = $1`, [id]);
    return rows[0] ? toPage(rows[0]) : null;
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE pages SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ? toPage(rows[0]) : null;
}

export async function insertBlock(
  pool: Pool,
  pageId: string,
  block: Block,
): Promise<Block> {
  const { rows } = await pool.query(
    `INSERT INTO blocks (id, page_id, index, children, type, content, attributes, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      block.id, block.pageId, block.index, block.children, block.type,
      block.content, block.attributes, block.authorId,
    ],
  );
  return toBlock(rows[0]);
}

export async function updateBlock(
  pool: Pool,
  id: string,
  changes: Partial<Block>,
): Promise<Block | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    content: "content",
    attributes: "attributes",
    index: "index",
    children: "children",
    type: "type",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in changes) {
      fields.push(`${col} = $${idx++}`);
      values.push((changes as Record<string, unknown>)[key]);
    }
  }

  if (fields.length === 0) {
    const { rows } = await pool.query(`SELECT * FROM blocks WHERE id = $1`, [id]);
    return rows[0] ? toBlock(rows[0]) : null;
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE blocks SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ? toBlock(rows[0]) : null;
}

export async function deleteBlock(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE blocks SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function getPageById(pool: Pool, id: string): Promise<Page | null> {
  const { rows } = await pool.query(`SELECT * FROM pages WHERE id = $1`, [id]);
  return rows[0] ? toPage(rows[0]) : null;
}
