// ── Cross-Session Persistent Memory Store ──
// Memory that survives across separate chat sessions.
// Session stitching via user identity.
// Configurable retention policies per profile.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Pool } from "pg"
import type {
  CrossSessionMemory,
  RetentionPolicy,
  RetentionAction,
  MemoryHandle,
  Conversation,
} from "../types.js"
import { DEFAULT_RETENTION_POLICY } from "../types.js"

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"
const CROSS_SESSION_FILE = "cross_session_memories.json"

// ── Interface ──

export interface ICrossSessionStore {
  /** Retrieve all cross-session memories for a given user */
  getMemories(userId: string, profileId?: string): Promise<CrossSessionMemory[]>
  /** Store a new cross-session memory */
  addMemory(userId: string, memory: CrossSessionMemory): Promise<void>
  /** Bulk add memories */
  addMemories(userId: string, memories: CrossSessionMemory[]): Promise<void>
  /** Remove a specific memory by id */
  removeMemory(userId: string, memoryId: string): Promise<boolean>
  /** Find a memory by id */
  getMemory(userId: string, memoryId: string): Promise<CrossSessionMemory | undefined>
  /** Search cross-session memories by keyword across all conversations for a user */
  searchMemories(userId: string, query: string, profileId?: string): Promise<CrossSessionMemory[]>
  /** Apply retention policy: evict memories that exceed limits */
  enforceRetention(userId: string, policy: RetentionPolicy, profileId?: string): Promise<number>
  /** Pin/unpin a memory so it survives eviction */
  pinMemory(userId: string, memoryId: string, reason: string): Promise<boolean>
  unpinMemory(userId: string, memoryId: string): Promise<boolean>
  /** List conversation IDs that belong to a user (session stitching) */
  listUserConversationIds(userId: string): Promise<string[]>
  /** Collect all memory handles across all conversations for a user */
  collectCrossSessionHandles(userId: string, conversations: Conversation[]): Promise<MemoryHandle[]>
  /** Stitch cross-session context: inject cross-session memories into a conversation's context */
  stitchIntoConversation(userId: string, conv: Conversation, policy?: RetentionPolicy): Promise<{ stitchedMemories: MemoryHandle[]; summary: string }>
  /** Get total count of cross-session memories for a user */
  size(userId: string, profileId?: string): Promise<number>
}

// ── File-based Implementation ──

export class CrossSessionStore implements ICrossSessionStore {
  private memoriesByUser = new Map<string, CrossSessionMemory[]>()
  private path: string
  private dirty = false

  constructor() {
    this.path = join(DATA_DIR, CROSS_SESSION_FILE)
    mkdir(DATA_DIR, { recursive: true })
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) return
    try {
      const raw = await readFile(this.path, "utf-8")
      const data = JSON.parse(raw) as Array<{ userId: string; memories: CrossSessionMemory[] }>
      for (const { userId, memories } of data) {
        this.memoriesByUser.set(userId, memories)
      }
    } catch (err) {
      console.error("Failed to load cross-session memories:", err)
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    const data = Array.from(this.memoriesByUser.entries()).map(([userId, memories]) => ({
      userId,
      memories,
    }))
    await writeFile(this.path, JSON.stringify(data, null, 2))
    this.dirty = false
  }

  private getUserMemories(userId: string): CrossSessionMemory[] {
    let list = this.memoriesByUser.get(userId)
    if (!list) {
      list = []
      this.memoriesByUser.set(userId, list)
    }
    return list
  }

  async getMemories(userId: string, profileId?: string): Promise<CrossSessionMemory[]> {
    const all = this.getUserMemories(userId)
    if (profileId) {
      return all.filter((m) => !m.profileId || m.profileId === profileId)
    }
    return [...all]
  }

  async addMemory(userId: string, memory: CrossSessionMemory): Promise<void> {
    const list = this.getUserMemories(userId)
    const existing = list.findIndex((m) => m.id === memory.id)
    if (existing >= 0) {
      list[existing] = memory
    } else {
      list.push(memory)
    }
    this.dirty = true
    await this.save()
  }

  async addMemories(userId: string, memories: CrossSessionMemory[]): Promise<void> {
    const list = this.getUserMemories(userId)
    for (const memory of memories) {
      const existing = list.findIndex((m) => m.id === memory.id)
      if (existing >= 0) {
        list[existing] = memory
      } else {
        list.push(memory)
      }
    }
    this.dirty = true
    await this.save()
  }

  async removeMemory(userId: string, memoryId: string): Promise<boolean> {
    const list = this.getUserMemories(userId)
    const before = list.length
    this.memoriesByUser.set(
      userId,
      list.filter((m) => m.id !== memoryId),
    )
    const removed = list.length !== before
    if (removed) {
      this.dirty = true
      await this.save()
    }
    return removed
  }

  async getMemory(userId: string, memoryId: string): Promise<CrossSessionMemory | undefined> {
    const list = this.getUserMemories(userId)
    return list.find((m) => m.id === memoryId)
  }

  async searchMemories(userId: string, query: string, profileId?: string): Promise<CrossSessionMemory[]> {
    const q = query.toLowerCase()
    const all = this.getUserMemories(userId)
    let filtered = profileId
      ? all.filter((m) => !m.profileId || m.profileId === profileId)
      : all

    return filtered.filter(
      (m) =>
        m.topic.toLowerCase().includes(q) ||
        m.summaryText.toLowerCase().includes(q) ||
        m.metadata?.tags?.toString().toLowerCase().includes(q),
    )
  }

  async enforceRetention(userId: string, policy: RetentionPolicy, profileId?: string): Promise<number> {
    const list = this.getUserMemories(userId)
    let targeted = profileId
      ? list.filter((m) => m.profileId === profileId)
      : list

    // Never evict pinned memories
    const evictable = targeted.filter((m) => !m.pinned)
    const now = Date.now()
    let evicted = 0

    // Apply retention triggers
    let toEvict: CrossSessionMemory[] = []

    if (policy.trigger === "memory_count" && evictable.length > policy.maxMemories) {
      const excess = evictable.length - policy.maxMemories
      toEvict = this.selectEvictionCandidates(evictable, excess, policy.action)
    } else if (policy.trigger === "age_days") {
      const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000
      toEvict = evictable.filter((m) => m.createdAt < cutoff)
    } else if (policy.trigger === "token_count") {
      // Estimate token usage from summary text
      let totalTokens = evictable.reduce((sum, m) => sum + Math.ceil(m.summaryText.length / 4), 0)
      if (totalTokens > policy.maxTokens) {
        const sorted = [...evictable].sort((a, b) => a.importanceScore - b.importanceScore)
        while (totalTokens > policy.maxTokens && sorted.length > 0) {
          const candidate = sorted.shift()!
          totalTokens -= Math.ceil(candidate.summaryText.length / 4)
          toEvict.push(candidate)
        }
      }
    }

    // Also evict individually expired memories
    const expired = evictable.filter(
      (m) => m.expiresAt !== null && m.expiresAt <= now,
    )
    toEvict = [...new Set([...toEvict, ...expired])]

    if (toEvict.length > 0) {
      const evictIds = new Set(toEvict.map((m) => m.id))
      this.memoriesByUser.set(
        userId,
        list.filter((m) => !evictIds.has(m.id)),
      )
      evicted = toEvict.length
      this.dirty = true
      await this.save()
    }

    return evicted
  }

  private selectEvictionCandidates(
    memories: CrossSessionMemory[],
    count: number,
    action: RetentionAction,
  ): CrossSessionMemory[] {
    switch (action) {
      case "evict_oldest":
        return [...memories].sort((a, b) => a.createdAt - b.createdAt).slice(0, count)
      case "evict_lowest_importance":
        return [...memories].sort((a, b) => a.importanceScore - b.importanceScore).slice(0, count)
      case "compress_to_summary":
        // For compress_to_summary, we evict the least important by default
        return [...memories].sort((a, b) => a.importanceScore - b.importanceScore).slice(0, count)
      default:
        return memories.slice(0, count)
    }
  }

  async pinMemory(userId: string, memoryId: string, reason: string): Promise<boolean> {
    const mem = await this.getMemory(userId, memoryId)
    if (!mem) return false
    mem.pinned = true
    mem.pinReason = reason
    this.dirty = true
    await this.save()
    return true
  }

  async unpinMemory(userId: string, memoryId: string): Promise<boolean> {
    const mem = await this.getMemory(userId, memoryId)
    if (!mem) return false
    mem.pinned = false
    mem.pinReason = undefined
    this.dirty = true
    await this.save()
    return true
  }

  async listUserConversationIds(_userId: string): Promise<string[]> {
    // File-based store doesn't track per-user conversation ids natively.
    // This is handled by the Pg implementation.
    return []
  }

  async collectCrossSessionHandles(userId: string, conversations: Conversation[]): Promise<MemoryHandle[]> {
    const xmemories = await this.getMemories(userId)
    return xmemories.map((xm) => ({
      id: xm.id,
      topic: xm.topic,
      turnRange: `${xm.sourceSpanIds.length} spans`,
      spanId: xm.sourceSpanIds[0] || "",
      pinned: xm.pinned,
      pinReason: xm.pinReason,
      embeddingId: xm.embeddingId,
      crossSession: true,
    } as MemoryHandle))
  }

  async stitchIntoConversation(
    userId: string,
    conv: Conversation,
    policy?: RetentionPolicy,
  ): Promise<{ stitchedMemories: MemoryHandle[]; summary: string }> {
    const memories = await this.getMemories(userId)
    const effectivePolicy = policy || DEFAULT_RETENTION_POLICY

    // Apply retention before stitching
    const evicted = await this.enforceRetention(userId, effectivePolicy)
    if (evicted > 0) {
      console.log(`[cross-session] Enforced retention for ${userId}: evicted ${evicted} memories`)
    }

    const handles: MemoryHandle[] = memories.map((xm) => ({
      id: xm.id,
      topic: xm.topic,
      turnRange: `${xm.sourceSpanIds.length} spans`,
      spanId: xm.sourceSpanIds[0] || "",
      pinned: xm.pinned,
      pinReason: xm.pinReason,
      embeddingId: xm.embeddingId,
      crossSession: true,
    } as MemoryHandle))

    // Merge into conversation's memories (dedup by id)
    const existingIds = new Set(conv.memories.map((m) => m.id))
    for (const handle of handles) {
      if (!existingIds.has(handle.id)) {
        conv.memories.push(handle)
        existingIds.add(handle.id)
      }
    }

    const summary = memories.length > 0
      ? `Session stitched: ${memories.length} cross-session memories loaded (${memories.filter((m) => m.pinned).length} pinned)`
      : "No cross-session memories found for this user"

    conv.updatedAt = Date.now()
    conv.metadata = {
      ...conv.metadata,
      stitchedUserId: userId,
      stitchedAt: Date.now(),
      crossSessionMemoryCount: memories.length,
    }

    return { stitchedMemories: handles, summary }
  }

  async size(userId: string, profileId?: string): Promise<number> {
    const memories = await this.getMemories(userId, profileId)
    return memories.length
  }
}

// ── Postgres Implementation ──

export class PgCrossSessionStore implements ICrossSessionStore {
  private pool: Pool

  constructor(pool?: Pool) {
    this.pool = pool || new Pool({ connectionString: process.env.ENGRA_DATABASE_URL })
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cross_session_memories (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
        profile_id TEXT,
        topic TEXT NOT NULL,
        summary_text TEXT NOT NULL DEFAULT '',
        source_conversation_id TEXT NOT NULL,
        source_span_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        importance_score REAL NOT NULL DEFAULT 0.5,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        pin_reason TEXT,
        embedding_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        expires_at BIGINT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (id, user_id)
      )
    `)
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_xmem_user_id ON cross_session_memories(user_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_xmem_profile_id ON cross_session_memories(profile_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_xmem_pinned ON cross_session_memories(user_id, pinned)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_xmem_created_at ON cross_session_memories(user_id, created_at)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_xmem_expires_at ON cross_session_memories(user_id, expires_at)")
  }

  private rowToMemory(row: Record<string, unknown>): CrossSessionMemory {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      profileId: (row.profile_id as string) || undefined,
      topic: row.topic as string,
      summaryText: row.summary_text as string,
      sourceConversationId: row.source_conversation_id as string,
      sourceSpanIds: (row.source_span_ids as string[]) || [],
      importanceScore: row.importance_score as number,
      pinned: row.pinned as boolean,
      pinReason: (row.pin_reason as string) || undefined,
      embeddingId: (row.embedding_id as string) || undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      expiresAt: (row.expires_at as number) || null,
      metadata: (row.metadata as Record<string, unknown>) || {},
    }
  }

  async getMemories(userId: string, profileId?: string): Promise<CrossSessionMemory[]> {
    if (profileId) {
      const r = await this.pool.query(
        "SELECT * FROM cross_session_memories WHERE user_id = $1 AND (profile_id = $2 OR profile_id IS NULL) ORDER BY created_at DESC",
        [userId, profileId],
      )
      return r.rows.map(this.rowToMemory)
    }
    const r = await this.pool.query(
      "SELECT * FROM cross_session_memories WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    )
    return r.rows.map(this.rowToMemory)
  }

  async addMemory(userId: string, memory: CrossSessionMemory): Promise<void> {
    await this.pool.query(
      `INSERT INTO cross_session_memories (
        id, user_id, profile_id, topic, summary_text,
        source_conversation_id, source_span_ids, importance_score,
        pinned, pin_reason, embedding_id, created_at, updated_at,
        expires_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT (id, user_id) DO UPDATE SET
        topic = $4, summary_text = $5, importance_score = $8,
        pinned = $9, pin_reason = $10, updated_at = $13,
        expires_at = $14, metadata = $15::jsonb`,
      [
        memory.id, userId, memory.profileId || null, memory.topic, memory.summaryText,
        memory.sourceConversationId, JSON.stringify(memory.sourceSpanIds), memory.importanceScore,
        memory.pinned, memory.pinReason || null, memory.embeddingId || null,
        memory.createdAt, memory.updatedAt,
        memory.expiresAt, JSON.stringify(memory.metadata),
      ],
    )
  }

  async addMemories(userId: string, memories: CrossSessionMemory[]): Promise<void> {
    for (const memory of memories) {
      await this.addMemory(userId, memory)
    }
  }

  async removeMemory(userId: string, memoryId: string): Promise<boolean> {
    const r = await this.pool.query(
      "DELETE FROM cross_session_memories WHERE id = $1 AND user_id = $2",
      [memoryId, userId],
    )
    return (r.rowCount ?? 0) > 0
  }

  async getMemory(userId: string, memoryId: string): Promise<CrossSessionMemory | undefined> {
    const r = await this.pool.query(
      "SELECT * FROM cross_session_memories WHERE id = $1 AND user_id = $2",
      [memoryId, userId],
    )
    return r.rows.length ? this.rowToMemory(r.rows[0]) : undefined
  }

  async searchMemories(userId: string, query: string, profileId?: string): Promise<CrossSessionMemory[]> {
    const tsquery = query.replace(/[^\w\s]/g, "").trim().split(/\s+/).filter(Boolean).join(" | ")
    if (!tsquery) return []

    try {
      if (profileId) {
        const r = await this.pool.query(
          `SELECT * FROM cross_session_memories
           WHERE user_id = $1
             AND (profile_id = $2 OR profile_id IS NULL)
             AND (to_tsvector('english', topic || ' ' || summary_text) @@ to_tsquery('english', $3)
                  OR topic ILIKE $4 OR summary_text ILIKE $4)
           ORDER BY importance_score DESC, created_at DESC
           LIMIT 50`,
          [userId, profileId, tsquery, `%${query}%`],
        )
        return r.rows.map(this.rowToMemory)
      }
      const r = await this.pool.query(
        `SELECT * FROM cross_session_memories
         WHERE user_id = $1
           AND (to_tsvector('english', topic || ' ' || summary_text) @@ to_tsquery('english', $2)
                OR topic ILIKE $3 OR summary_text ILIKE $3)
         ORDER BY importance_score DESC, created_at DESC
         LIMIT 50`,
        [userId, tsquery, `%${query}%`],
      )
      return r.rows.map(this.rowToMemory)
    } catch {
      // Fallback to simple LIKE search if tsquery/tsvector not available
      if (profileId) {
        const r = await this.pool.query(
          `SELECT * FROM cross_session_memories
           WHERE user_id = $1 AND (profile_id = $2 OR profile_id IS NULL)
           ORDER BY importance_score DESC, created_at DESC`,
          [userId, profileId],
        )
        const qlower = query.toLowerCase()
        return r.rows.map(this.rowToMemory).filter(
          (m) => m.topic.toLowerCase().includes(qlower) || m.summaryText.toLowerCase().includes(qlower),
        )
      }
      const r = await this.pool.query(
        `SELECT * FROM cross_session_memories WHERE user_id = $1 ORDER BY importance_score DESC, created_at DESC`,
        [userId],
      )
      const qlower = query.toLowerCase()
      return r.rows.map(this.rowToMemory).filter(
        (m) => m.topic.toLowerCase().includes(qlower) || m.summaryText.toLowerCase().includes(qlower),
      )
    }
  }

  async enforceRetention(userId: string, policy: RetentionPolicy, profileId?: string): Promise<number> {
    let evicted = 0

    // Evict individually expired memories
    const expiredR = await this.pool.query(
      `DELETE FROM cross_session_memories
       WHERE user_id = $1 AND pinned = FALSE AND expires_at IS NOT NULL AND expires_at <= $2`,
      [userId, Date.now()],
    )
    evicted += expiredR.rowCount ?? 0

    if (policy.trigger === "memory_count") {
      const countR = await this.pool.query(
        `SELECT COUNT(*) AS cnt FROM cross_session_memories WHERE user_id = $1 AND pinned = FALSE`,
        [userId],
      )
      const count = parseInt(countR.rows[0].cnt as string, 10)
      if (count > policy.maxMemories) {
        const excess = count - policy.maxMemories
        const evictR = await this.pool.query(
          `DELETE FROM cross_session_memories
           WHERE id IN (
             SELECT id FROM cross_session_memories
             WHERE user_id = $1 AND pinned = FALSE
             ORDER BY importance_score ASC, created_at ASC
             LIMIT $2
           )`,
          [userId, excess],
        )
        evicted += evictR.rowCount ?? 0
      }
    } else if (policy.trigger === "age_days") {
      const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000
      const evictR = await this.pool.query(
        `DELETE FROM cross_session_memories
         WHERE user_id = $1 AND pinned = FALSE AND created_at < $2`,
        [userId, cutoff],
      )
      evicted += evictR.rowCount ?? 0
    } else if (policy.trigger === "token_count") {
      // Estimate: delete lowest-importance memories until under token budget
      // This requires a more complex approach — delete in batches
      let done = false
      while (!done) {
        const sumR = await this.pool.query(
          `SELECT COALESCE(SUM(LENGTH(summary_text)), 0) AS total_len
           FROM cross_session_memories WHERE user_id = $1 AND pinned = FALSE`,
          [userId],
        )
        const totalTokens = Math.ceil(parseInt(sumR.rows[0].total_len as string, 10) / 4)
        if (totalTokens <= policy.maxTokens) {
          done = true
        } else {
          const evictR = await this.pool.query(
            `DELETE FROM cross_session_memories
             WHERE id = (
               SELECT id FROM cross_session_memories
               WHERE user_id = $1 AND pinned = FALSE
               ORDER BY importance_score ASC, created_at ASC
               LIMIT 1
             )`,
            [userId],
          )
          if ((evictR.rowCount ?? 0) === 0) done = true
          else evicted += evictR.rowCount ?? 0
        }
      }
    }

    return evicted
  }

  async pinMemory(userId: string, memoryId: string, reason: string): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE cross_session_memories SET pinned = TRUE, pin_reason = $1, updated_at = $2 WHERE id = $3 AND user_id = $4",
      [reason, Date.now(), memoryId, userId],
    )
    return (r.rowCount ?? 0) > 0
  }

  async unpinMemory(userId: string, memoryId: string): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE cross_session_memories SET pinned = FALSE, pin_reason = NULL, updated_at = $1 WHERE id = $2 AND user_id = $3",
      [Date.now(), memoryId, userId],
    )
    return (r.rowCount ?? 0) > 0
  }

  async listUserConversationIds(userId: string): Promise<string[]> {
    const r = await this.pool.query(
      "SELECT id FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId],
    )
    return r.rows.map((row) => row.id as string)
  }

  async collectCrossSessionHandles(userId: string, _conversations: Conversation[]): Promise<MemoryHandle[]> {
    const memories = await this.getMemories(userId)
    return memories.map((xm) => ({
      id: xm.id,
      topic: xm.topic,
      turnRange: `${xm.sourceSpanIds.length} spans`,
      spanId: xm.sourceSpanIds[0] || "",
      pinned: xm.pinned,
      pinReason: xm.pinReason,
      embeddingId: xm.embeddingId,
      crossSession: true,
    } as MemoryHandle))
  }

  async stitchIntoConversation(
    userId: string,
    conv: Conversation,
    policy?: RetentionPolicy,
  ): Promise<{ stitchedMemories: MemoryHandle[]; summary: string }> {
    // Enforce retention first
    const effectivePolicy = policy || DEFAULT_RETENTION_POLICY
    const evicted = await this.enforceRetention(userId, effectivePolicy)
    if (evicted > 0) {
      console.log(`[cross-session] Enforced retention for ${userId}: evicted ${evicted} memories`)
    }

    const memories = await this.getMemories(userId)
    const handles: MemoryHandle[] = memories.map((xm) => ({
      id: xm.id,
      topic: xm.topic,
      turnRange: `${xm.sourceSpanIds.length} spans`,
      spanId: xm.sourceSpanIds[0] || "",
      pinned: xm.pinned,
      pinReason: xm.pinReason,
      embeddingId: xm.embeddingId,
      crossSession: true,
    } as MemoryHandle))

    // Merge into conversation's memories (dedup by id)
    const existingIds = new Set(conv.memories.map((m) => m.id))
    for (const handle of handles) {
      if (!existingIds.has(handle.id)) {
        conv.memories.push(handle)
        existingIds.add(handle.id)
      }
    }

    const summary = memories.length > 0
      ? `Session stitched: ${memories.length} cross-session memories loaded (${memories.filter((m) => m.pinned).length} pinned)`
      : "No cross-session memories found for this user"

    conv.updatedAt = Date.now()
    conv.metadata = {
      ...conv.metadata,
      stitchedUserId: userId,
      stitchedAt: Date.now(),
      crossSessionMemoryCount: memories.length,
    }

    return { stitchedMemories: handles, summary }
  }

  async size(userId: string, profileId?: string): Promise<number> {
    if (profileId) {
      const r = await this.pool.query(
        "SELECT COUNT(*) AS cnt FROM cross_session_memories WHERE user_id = $1 AND profile_id = $2",
        [userId, profileId],
      )
      return parseInt(r.rows[0].cnt as string, 10)
    }
    const r = await this.pool.query(
      "SELECT COUNT(*) AS cnt FROM cross_session_memories WHERE user_id = $1",
      [userId],
    )
    return parseInt(r.rows[0].cnt as string, 10)
  }
}
