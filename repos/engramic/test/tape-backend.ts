import Fastify from "fastify"
import cors from "@fastify/cors"

export interface TapeEntry {
  status?: number
  body: unknown
}

export class TapeBackend {
  private app = Fastify({ logger: false })
  private entries: TapeEntry[] = []
  private callIndex = 0
  readonly port: number

  readonly requests: Array<{ url: string; body: unknown }> = []

  constructor(port: number) {
    this.port = port

    this.app.register(cors, { origin: true })

    this.app.post("/v1/chat/completions", async (request, reply) => {
      this.requests.push({ url: request.url, body: request.body })

      if (this.callIndex >= this.entries.length) {
        return reply.status(500).send({ error: "Tape exhausted", call_index: this.callIndex, total_tapes: this.entries.length })
      }

      const entry = this.entries[this.callIndex]
      this.callIndex++

      if (entry.status) {
        reply.status(entry.status)
      }
      return reply.send(entry.body)
    })

    this.app.post("/v1/embeddings", async (_request, reply) => {
      return reply.send({
        object: "list",
        data: [{ embedding: new Array(1536).fill(0.01), index: 0 }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 10, total_tokens: 10 },
      })
    })
  }

  add(entry: TapeEntry): void {
    this.entries.push(entry)
  }

  addToolCall(name: string, args: Record<string, unknown>, finishReason = "tool_calls"): void {
    this.add({
      body: {
        id: "chatcmpl-tape",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4o",
        choices: [{
          index: 0,
          finish_reason: finishReason,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: `call_${Date.now()}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            }],
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      },
    })
  }

  addText(content: string, finishReason = "stop"): void {
    this.add({
      body: {
        id: "chatcmpl-tape",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4o",
        choices: [{
          index: 0,
          finish_reason: finishReason,
          message: { role: "assistant", content },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      },
    })
  }

  reset(): void {
    this.callIndex = 0
    this.requests.length = 0
    this.entries.length = 0
  }

  get callCount(): number {
    return this.callIndex
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: "127.0.0.1" })
  }

  async stop(): Promise<void> {
    await this.app.close()
  }
}
