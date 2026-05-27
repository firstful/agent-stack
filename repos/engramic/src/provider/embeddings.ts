export interface EmbeddingsProvider {
  readonly name: string
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}

const DEFAULT_EMBEDDING_MODEL = process.env.ENGRA_EMBEDDING_MODEL || "text-embedding-3-small"

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
    this.model = model || DEFAULT_EMBEDDING_MODEL
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

export class NoopEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "noop"
  readonly dimensions = 0
  async embed(_text: string): Promise<number[]> { return [] }
  async embedBatch(_texts: string[]): Promise<number[][]> { return [] }
}
