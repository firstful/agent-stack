import { Provider } from "./index.js"
import type { ProviderCapabilities, ProviderRequest, ProviderResponse, ProviderStreamEvent, Message } from "../types.js"

interface OpenAIMessage {
  role: string
  content: string | Array<Record<string, unknown>>
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
  stream_options?: { include_usage: boolean }
  max_tokens?: number
  temperature?: number
  response_format?: unknown
  parallel_tool_calls?: boolean
  tool_choice?: string | { type: "function"; function: { name: string } }
  tools?: unknown[]
  user?: string
}

interface OpenAIResponse {
  id: string
  model: string
  choices: Array<{
    finish_reason: string | null
    message: OpenAIMessage
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

function toInternalMessage(role: string, content: string | Array<Record<string, unknown>> | null, toolCalls?: OpenAIResponse["choices"][0]["message"]["tool_calls"], toolCallId?: string): Message {
  const parts: Message["content"] = []
  if (typeof content === "string") {
    parts.push({ type: "text", text: content })
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "text") {
        parts.push({ type: "text", text: String(part.text) })
      } else if (part.type === "image_url") {
        parts.push({ type: "image_url", image_url: part.image_url as { url: string } })
      }
    }
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      parts.push({
        type: "tool_call",
        id: tc.id,
        function: tc.function,
      })
    }
  }
  return {
    id: `msg_${Math.random().toString(36).slice(2, 9)}`,
    role: role as Message["role"],
    content: parts,
    metadata: toolCallId ? { tool_call_id: toolCallId } : undefined,
  }
}

function toExternalMessage(msg: Message, addTools: boolean): OpenAIMessage {
  const textParts = msg.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("")
  const imageParts = msg.content.filter((p) => p.type === "image_url").map((p) => ({ type: "image_url", image_url: (p as { type: "image_url"; image_url: { url: string } }).image_url }))
  const toolCalls = msg.content.filter((p) => p.type === "tool_call")

  const result: OpenAIMessage = { role: msg.role, content: textParts || "" }

  if (imageParts.length > 0) {
    result.content = [{ type: "text", text: textParts }, ...imageParts]
  }

  if (addTools && toolCalls.length > 0) {
    result.tool_calls = toolCalls.map((p) => ({
      id: p.id,
      type: "function" as const,
      function: (p as { type: "tool_call"; function: { name: string; arguments: string } }).function,
    }))
  }

  const toolResult = msg.content.find((p) => p.type === "tool_result")
  if (toolResult) {
    result.tool_call_id = msg.metadata?.tool_call_id as string || (toolResult as { type: "tool_result"; tool_call_id: string }).tool_call_id
    result.content = (toolResult as { type: "tool_result"; content: string }).content
    result.role = "tool"
  }

  return result
}

export const OPENAI_CAPABILITIES: ProviderCapabilities = {
  tools: true,
  streaming: true,
  vision: true,
  jsonMode: true,
  parallelToolCalls: true,
  reasoningTokens: false,
}

export class OpenAIProvider implements Provider {
  readonly name = "openai"
  readonly capabilities = OPENAI_CAPABILITIES
  private apiKey: string
  private baseUrl: string

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.ENGRA_OPENAI_API_KEY || ""
    this.baseUrl = baseUrl || process.env.ENGRA_OPENAI_BASE_URL || "https://api.openai.com/v1"
  }

  private async request(body: OpenAIRequest, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${text}`)
    }
    return res
  }

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.buildRequest(request, false)
    const res = await this.request(body)
    const data = (await res.json()) as OpenAIResponse
    const choice = data.choices[0]
    return {
      id: data.id,
      model: data.model,
      message: toInternalMessage(choice.message.role, choice.message.content, choice.message.tool_calls),
      finish_reason: choice.finish_reason,
      usage: data.usage,
    }
  }

  async *chatStream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = this.buildRequest(request, true)
    const res = await this.request(body)
    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data: ")) continue
        const payload = trimmed.slice(6)
        if (payload === "[DONE]") {
          yield { type: "done", data: null }
          return
        }
        try {
          const parsed = JSON.parse(payload)
          if (parsed.usage) {
            yield { type: "usage", data: { prompt_tokens: parsed.usage.prompt_tokens, completion_tokens: parsed.usage.completion_tokens, total_tokens: parsed.usage.total_tokens } }
            continue
          }
          const delta = parsed.choices?.[0]?.delta
          if (!delta) continue

          if (delta.tool_calls) {
            yield { type: "tool_call", data: delta.tool_calls }
          } else if (delta.content) {
            yield { type: "chunk", data: delta.content }
          } else if (delta.role) {
            yield { type: "chunk", data: "" }
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    yield { type: "done", data: null }
  }

  getBaseUrl(): string { return this.baseUrl }
  getApiKey(): string { return this.apiKey }

  private buildRequest(request: ProviderRequest, stream: boolean): OpenAIRequest {
    return {
      model: request.model,
      messages: request.messages.map((m) => {
        const hasToolCalls = m.content.some((p) => p.type === "tool_call")
        const hasToolResult = m.content.some((p) => p.type === "tool_result")
        return toExternalMessage(m, hasToolCalls || hasToolResult)
      }),
      stream,
      stream_options: stream ? { include_usage: true } : undefined,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      response_format: request.response_format,
      parallel_tool_calls: request.parallel_tool_calls,
      tool_choice: request.tool_choice,
      tools: request.tools as Record<string, unknown>[] | undefined,
      user: request.user as string | undefined,
    }
  }
}
