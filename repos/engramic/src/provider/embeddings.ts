import { pipeline } from "@xenova/transformers"
import crypto from "node:crypto"

export interface EmbeddingsProvider {
  readonly name: string
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

// ---------------------------------------------------------------------------
// Local — runs bge-small on CPU via Transformers.js (ONNX)
// ---------------------------------------------------------------------------

const LOCAL_MODEL = process.env.ENGRA_EMBEDDING_LOCAL_MODEL || "Xenova/bge-small-en-v1.5"

export class LocalEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "local"
  readonly dimensions = 384
  private model: Promise<any> | null = null

  private async getPipeline(): Promise<any> {
    if (!this.model) {
      this.model = pipeline("feature-extraction", LOCAL_MODEL)
    }
    return this.model
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text])
    return vec
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const extractor = await this.getPipeline()
    const results: number[][] = []
    for (const text of texts) {
      const output = await extractor(text, { pooling: "mean", normalize: true })
      results.push(Array.from(output.data))
    }
    return results
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible remote provider
// ---------------------------------------------------------------------------

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}

export class OpenAIEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "openai"
  readonly dimensions = 1536
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(apiKey?: string, baseUrl?: string, model?: string) {
    this.apiKey = apiKey || process.env.ENGRA_OPENAI_API_KEY || ""
    this.baseUrl = baseUrl || process.env.ENGRA_OPENAI_BASE_URL || "https://api.openai.com/v1"
    this.model = model || process.env.ENGRA_EMBEDDING_MODEL || "text-embedding-3-small"
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text])
    return vec
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Embedding API error ${res.status}: ${body}`)
    }

    const data = (await res.json()) as OpenAIEmbeddingResponse
    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map((d) => d.embedding)
  }
}

// ---------------------------------------------------------------------------
// Noop (testing / fallback)
// ---------------------------------------------------------------------------

export class NoopEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "noop"
  readonly dimensions = 0
  async embed(_text: string): Promise<number[]> { return [] }
  async embedBatch(texts: string[]): Promise<number[][]> { return texts.map(() => []) }
}

// ---------------------------------------------------------------------------
// Cache — deduplicates repeated texts
// ---------------------------------------------------------------------------

export class EmbeddingCache {
  private cache = new Map<string, { vector: number[]; hit: number }>()
  private provider: EmbeddingsProvider
  private maxSize: number

  constructor(provider: EmbeddingsProvider, maxSize = 10_000) {
    this.provider = provider
    this.maxSize = maxSize
  }

  private key(text: string): string {
    return crypto.createHash("md5").update(text).digest("hex")
  }

  async embed(text: string): Promise<number[]> {
    const k = this.key(text)
    const existing = this.cache.get(k)
    if (existing) {
      existing.hit++
      return existing.vector
    }
    const vector = await this.provider.embed(text)
    this.cache.set(k, { vector, hit: 0 })
    if (this.cache.size > this.maxSize) this.evict()
    return vector
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length)
    const missing: { index: number; text: string }[] = []

    for (let i = 0; i < texts.length; i++) {
      const k = this.key(texts[i])
      const existing = this.cache.get(k)
      if (existing) {
        existing.hit++
        results[i] = existing.vector
      } else {
        missing.push({ index: i, text: texts[i] })
      }
    }

    if (missing.length > 0) {
      const vectors = await this.provider.embedBatch(missing.map((m) => m.text))
      for (let j = 0; j < missing.length; j++) {
        const { index } = missing[j]
        const vector = vectors[j]
        results[index] = vector
        this.cache.set(this.key(missing[j].text), { vector, hit: 0 })
      }
    }

    if (this.cache.size > this.maxSize) this.evict()
    return results
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  private evict(): void {
    const sorted = Array.from(this.cache.entries()).sort((a, b) => a[1].hit - b[1].hit)
    const remove = sorted.slice(0, Math.floor(this.maxSize * 0.2))
    for (const [k] of remove) this.cache.delete(k)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type EmbeddingsProviderKind = "local" | "openai" | "noop"

export interface EmbeddingsConfig {
  kind: EmbeddingsProviderKind
  apiKey?: string
  baseUrl?: string
  model?: string
}

export function createEmbeddingsProvider(config?: EmbeddingsConfig): EmbeddingsProvider {
  const kind = config?.kind || (process.env.ENGRA_EMBEDDING_PROVIDER as EmbeddingsProviderKind) || "openai"
  switch (kind) {
    case "local":
      return new LocalEmbeddingsProvider()
    case "openai":
      return new OpenAIEmbeddingsProvider(
        config?.apiKey,
        config?.baseUrl,
        config?.model,
      )
    case "noop":
      return new NoopEmbeddingsProvider()
  }
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
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
