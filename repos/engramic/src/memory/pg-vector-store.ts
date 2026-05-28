import { Pool } from "pg"
import type { EmbeddingsProvider } from "../provider/embeddings.js"
import { cosineSimilarity } from "../provider/embeddings.js"
import type { VectorRecord, ScoredMatch } from "./vector.js"
import type { MemoryHandle } from "../types.js"

function parseVector(v: unknown): number[] {
  if (typeof v === "string") return JSON.parse(v)
  if (Array.isArray(v)) return v as number[]
  return []
}

function rowToRecord(row: Record<string, unknown>): VectorRecord {
  return {
    id: row.id as string,
    vector: parseVector(row.vector),
    text: row.text as string,
    sourceId: row.source_id as string,
    sourceType: row.source_type as VectorRecord["sourceType"],
    createdAt: row.created_at as number,
  }
}

function dimsFromColumn(col: string): number {
  const m = col.match(/^vector\((\d+)\)$/)
  return m ? parseInt(m[1], 10) : 0
}

export class PgVectorStore {
  private pool: Pool
  private embeddingsProvider: EmbeddingsProvider
  private convId: string
  private userId = ""
  private initialized = false
  private userIdCache = new Map<string, string>()

  constructor(embeddingsProvider: EmbeddingsProvider, convId?: string, pool?: Pool) {
    this.embeddingsProvider = embeddingsProvider
    this.convId = convId || ""
    this.pool = pool || new Pool({ connectionString: process.env.ENGRA_DATABASE_URL })
  }

  bind(convId: string): void {
    this.convId = convId
    this.userId = ""
  }

  bindUser(userId: string): void {
    this.userId = userId
  }

  private async lookupUserId(): Promise<string> {
    if (this.userId) return this.userId
    const cached = this.userIdCache.get(this.convId)
    if (cached) return cached
    const r = await this.pool.query("SELECT user_id FROM conversations WHERE id = $1", [this.convId])
    if (r.rows.length) {
      const uid = r.rows[0].user_id as string
      this.userId = uid
      this.userIdCache.set(this.convId, uid)
      return uid
    }
    return ""
  }

  async init(): Promise<void> {
    if (this.initialized) return
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector")
    const test = await this.embeddingsProvider.embed("init")
    const dims = test.length

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
        vector vector(${dims}) NOT NULL,
        text TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('memory', 'span', 'summary')),
        created_at BIGINT NOT NULL
      )
    `)
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_vectors_conv_id ON vectors(conv_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_vectors_source_id ON vectors(source_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_vectors_user_id ON vectors(user_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_vectors_vector ON vectors USING ivfflat (vector vector_cosine_ops) WITH (lists = 100)")

    await this.pool.query("ALTER TABLE vectors ENABLE ROW LEVEL SECURITY")
    await this.pool.query("DROP POLICY IF EXISTS vectors_user_isolation ON vectors")
    await this.pool.query(`CREATE POLICY vectors_user_isolation ON vectors USING (user_id = current_setting('app.user_id', true)::TEXT)`)

    this.initialized = true
  }

  async insert(id: string, text: string, sourceId: string, sourceType: VectorRecord["sourceType"]): Promise<string> {
    await this.init()
    const uid = await this.lookupUserId()
    const vector = await this.embeddingsProvider.embed(text)
    const vecStr = `[${vector.join(",")}]`
    await this.pool.query(
      `INSERT INTO vectors (id, conv_id, user_id, vector, text, source_id, source_type, created_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET user_id = $3, text = $5, source_id = $6, source_type = $7, created_at = $8`,
      [id, this.convId, uid, vecStr, text, sourceId, sourceType, Date.now()],
    )
    return id
  }

  async remove(id: string): Promise<void> {
    await this.pool.query("DELETE FROM vectors WHERE id = $1", [id])
  }

  get(id: string): Promise<VectorRecord | undefined> {
    return this.pool.query("SELECT * FROM vectors WHERE id = $1", [id]).then((r) => (r.rows.length ? rowToRecord(r.rows[0]) : undefined))
  }

  size(): Promise<number> {
    return this.pool
      .query("SELECT COUNT(*) AS cnt FROM vectors WHERE conv_id = $1", [this.convId])
      .then((r) => parseInt(r.rows[0].cnt as string, 10))
  }

  async search(query: string, topK = 5): Promise<ScoredMatch[]> {
    await this.init()
    const queryVector = await this.embeddingsProvider.embed(query)
    const vecStr = `[${queryVector.join(",")}]`
    const result = await this.pool.query(
      `SELECT *, 1 - (vector <=> $1::vector) AS score FROM vectors WHERE conv_id = $2 ORDER BY vector <=> $1::vector LIMIT $3`,
      [vecStr, this.convId, topK],
    )
    return result.rows.map((row) => ({ record: rowToRecord(row), score: row.score as number }))
  }

  findBySourceId(sourceId: string): Promise<VectorRecord | undefined> {
    return this.pool
      .query("SELECT * FROM vectors WHERE source_id = $1 AND conv_id = $2 LIMIT 1", [sourceId, this.convId])
      .then((r) => (r.rows.length ? rowToRecord(r.rows[0]) : undefined))
  }

  findBySourceIds(sourceIds: string[]): Promise<VectorRecord[]> {
    if (sourceIds.length === 0) return Promise.resolve([])
    const placeholders = sourceIds.map((_, i) => `$${i + 2}`).join(",")
    return this.pool
      .query(`SELECT * FROM vectors WHERE source_id IN (${placeholders}) AND conv_id = $1`, [this.convId, ...sourceIds])
      .then((r) => r.rows.map(rowToRecord))
  }

  async searchMemories(query: string, memories: MemoryHandle[], topK = 5): Promise<Array<{ handle: MemoryHandle; score: number }>> {
    if (memories.length === 0) return []
    await this.init()

    const queryVector = await this.embeddingsProvider.embed(query)
    const haveEmbeddings = memories.filter((m) => m.embeddingId)

    if (haveEmbeddings.length === 0) {
      return memories.slice(0, topK).map((handle) => ({ handle, score: 0 }))
    }

    const ids = haveEmbeddings.map((m) => m.embeddingId!)
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(",")
    const vecStr = `[${queryVector.join(",")}]`

    const result = await this.pool.query(
      `SELECT id, 1 - (vector <=> $1::vector) AS score FROM vectors WHERE id IN (${placeholders}) ORDER BY vector <=> $1::vector LIMIT $3`,
      [vecStr, ...ids, topK],
    )

    const scoreMap = new Map(result.rows.map((r) => [r.id, r.score as number]))
    const scored = haveEmbeddings.map((handle) => ({
      handle,
      score: scoreMap.get(handle.embeddingId!) ?? 0,
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  async rankByImportance(topK?: number): Promise<ScoredMatch[]> {
    await this.init()
    const result = await this.pool.query("SELECT * FROM vectors WHERE conv_id = $1", [this.convId])
    const records = result.rows.map(rowToRecord)
    if (records.length === 0) return []
    if (records.length === 1) return [{ record: records[0], score: 1 }]

    const dims = records[0].vector.length
    const centroid = new Array(dims).fill(0)
    for (const rec of records) {
      for (let i = 0; i < dims; i++) centroid[i] += rec.vector[i]
    }
    for (let i = 0; i < dims; i++) centroid[i] /= records.length

    const scored: ScoredMatch[] = records.map((record) => {
      const distance = 1 - cosineSimilarity(record.vector, centroid)
      const score = 1 / (1 + distance)
      return { record, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return topK ? scored.slice(0, topK) : scored
  }
}
