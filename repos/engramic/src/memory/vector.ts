import { EmbeddingsProvider } from "../provider/embeddings.js"
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

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export class VectorStore {
  private records = new Map<string, VectorRecord>()
  private embeddingsProvider: EmbeddingsProvider

  constructor(embeddingsProvider: EmbeddingsProvider) {
    this.embeddingsProvider = embeddingsProvider
  }

  async insert(id: string, text: string, sourceId: string, sourceType: VectorRecord["sourceType"]): Promise<string> {
    const vector = await this.embeddingsProvider.embed(text)
    const record: VectorRecord = { id, vector, text, sourceId, sourceType, createdAt: Date.now() }
    this.records.set(id, record)
    return id
  }

  remove(id: string): void {
    this.records.delete(id)
  }

  get(id: string): VectorRecord | undefined {
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

  findBySourceId(sourceId: string): VectorRecord | undefined {
    for (const record of this.records.values()) {
      if (record.sourceId === sourceId) return record
    }
    return undefined
  }

  findBySourceIds(sourceIds: string[]): VectorRecord[] {
    const ids = new Set(sourceIds)
    return Array.from(this.records.values()).filter((r) => ids.has(r.sourceId))
  }

  size(): number {
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
}
