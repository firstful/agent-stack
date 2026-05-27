import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { EmbeddingsProvider, cosineSimilarity } from "../provider/embeddings.js"
import type { MemoryHandle } from "../types.js"

export interface VectorRecord {
  id: string
  vector: number[]
  text: string
  sourceId: string
  sourceType: "memory" | "span" | "summary"
  createdAt: number
}

export interface ScoredMatch {
  record: VectorRecord
  score: number
}

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"

export interface IVectorStore {
  bind(convId: string): void
  insert(id: string, text: string, sourceId: string, sourceType: VectorRecord["sourceType"]): Promise<string>
  remove(id: string): Promise<void>
  get(id: string): Promise<VectorRecord | undefined>
  size(): Promise<number>
  search(query: string, topK?: number): Promise<ScoredMatch[]>
  findBySourceId(sourceId: string): Promise<VectorRecord | undefined>
  findBySourceIds(sourceIds: string[]): Promise<VectorRecord[]>
  searchMemories(query: string, memories: MemoryHandle[], topK?: number): Promise<Array<{ handle: MemoryHandle; score: number }>>
  rankByImportance(topK?: number): Promise<ScoredMatch[]>
}

export class VectorStore implements IVectorStore {
  private records = new Map<string, VectorRecord>()
  private embeddingsProvider: EmbeddingsProvider
  private convId: string

  constructor(embeddingsProvider: EmbeddingsProvider, convId?: string) {
    this.embeddingsProvider = embeddingsProvider
    this.convId = convId || ""
  }

  bind(convId: string): void {
    this.convId = convId
  }

  private storePath(): string {
    return join(DATA_DIR, `${this.convId}.vectors.json`)
  }

  async save(): Promise<void> {
    if (!this.convId) return
    const dir = DATA_DIR
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const data = Array.from(this.records.entries()).map(([key, record]) => ({ key, record }))
    await writeFile(this.storePath(), JSON.stringify(data, null, 2))
  }

  async load(convId?: string): Promise<void> {
    if (convId) this.convId = convId
    if (!this.convId) return
    const path = this.storePath()
    if (!existsSync(path)) return
    const raw = await readFile(path, "utf-8")
    const data: Array<{ key: string; record: VectorRecord }> = JSON.parse(raw)
    this.records.clear()
    for (const { key, record } of data) {
      this.records.set(key, record)
    }
  }

  async insert(id: string, text: string, sourceId: string, sourceType: VectorRecord["sourceType"]): Promise<string> {
    const vector = await this.embeddingsProvider.embed(text)
    const record: VectorRecord = { id, vector, text, sourceId, sourceType, createdAt: Date.now() }
    this.records.set(id, record)
    return id
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
  }

  async get(id: string): Promise<VectorRecord | undefined> {
    return this.records.get(id)
  }

  async search(query: string, topK = 5): Promise<ScoredMatch[]> {
    if (this.records.size === 0) return []

    const queryVector = await this.embeddingsProvider.embed(query)
    const scored: ScoredMatch[] = []

    for (const record of this.records.values()) {
      const score = cosineSimilarity(queryVector, record.vector)
      scored.push({ record, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  async findBySourceId(sourceId: string): Promise<VectorRecord | undefined> {
    for (const record of this.records.values()) {
      if (record.sourceId === sourceId) return record
    }
    return undefined
  }

  async findBySourceIds(sourceIds: string[]): Promise<VectorRecord[]> {
    const ids = new Set(sourceIds)
    return Array.from(this.records.values()).filter((r) => ids.has(r.sourceId))
  }

  async size(): Promise<number> {
    return this.records.size
  }

  async searchMemories(query: string, memories: MemoryHandle[], topK = 5): Promise<Array<{ handle: MemoryHandle; score: number }>> {
    if (memories.length === 0) return []

    const queryVector = await this.embeddingsProvider.embed(query)
    const haveEmbeddings = memories.filter((m) => m.embeddingId && this.records.has(m.embeddingId!))

    if (haveEmbeddings.length === 0) {
      return memories.slice(0, topK).map((handle) => ({ handle, score: 0 }))
    }

    const scored: Array<{ handle: MemoryHandle; score: number }> = []
    for (const handle of haveEmbeddings) {
      const record = this.records.get(handle.embeddingId!)
      if (record) {
        const score = cosineSimilarity(queryVector, record.vector)
        scored.push({ handle, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  async rankByImportance(topK?: number): Promise<ScoredMatch[]> {
    if (this.records.size === 0) return []
    if (this.records.size === 1) {
      const rec = Array.from(this.records.values())[0]
      return [{ record: rec, score: 1 }]
    }

    const allVectors = Array.from(this.records.values())
    const dims = allVectors[0].vector.length
    const centroid = new Array(dims).fill(0)

    for (const rec of allVectors) {
      for (let i = 0; i < dims; i++) {
        centroid[i] += rec.vector[i]
      }
    }
    for (let i = 0; i < dims; i++) {
      centroid[i] /= allVectors.length
    }

    const scored: ScoredMatch[] = allVectors.map((record) => {
      const distance = 1 - cosineSimilarity(record.vector, centroid)
      const score = 1 / (1 + distance)
      return { record, score }
    })

    scored.sort((a, b) => b.score - a.score)
    return topK ? scored.slice(0, topK) : scored
  }
}
