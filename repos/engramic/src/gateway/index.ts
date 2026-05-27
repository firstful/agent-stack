import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { Conversation, Message, ChatCompletionRequest, TokenBudget, SummaryNode, RegisterRequest, RegisterResponse, AddProviderResponse, ProviderConfig } from "../types.js"
import type { IMemoryStore } from "../memory/store.js"
import type { IVectorStore } from "../memory/vector.js"
import type { IUserStore } from "../auth/user-store.js"
import { Provider } from "../provider/index.js"
import { ContextEngine, createBudget } from "../context/engine.js"
import { compressConversation } from "../context/compression.js"
import { createUserProviders, createFallbackProviders } from "../auth/provider-factory.js"
import type { UserProviders } from "../auth/provider-factory.js"
import { executeRemember } from "../tools/remember.js"
import { executeSearch } from "../tools/search.js"
import { executeCompressMemory } from "../tools/compress_memory.js"
import { executeExpandMemoryRange } from "../tools/expand_memory_range.js"
import { executePinMemory } from "../tools/pin_memory.js"
import { executeUnpinMemory } from "../tools/unpin_memory.js"
import { executeQueryMemoryGraph } from "../tools/query_memory_graph.js"
import { executeMergeMemories } from "../tools/merge_memories.js"
import { executeBudgetContext } from "../tools/budget_context.js"
import { executeSetMemoryPolicy } from "../tools/set_memory_policy.js"
import { executeExplainMemoryState } from "../tools/explain_memory_state.js"
import { executeSimulateExpansionCost } from "../tools/simulate_expansion_cost.js"
import { executeMarkEvent } from "../tools/mark_event.js"
import { executeRebuildContextWindow } from "../tools/rebuild_context_window.js"
import { createStreamBuffer, appendToBuffer, flushBuffer, serializeNonStreamResponse, serializeStreamChunk, serializeStreamDone } from "./stream.js"
import type { CompressionLevel } from "../tools/compress_memory.js"
import type { EventType } from "../tools/mark_event.js"
import type { FocusType } from "../tools/rebuild_context_window.js"
import type { BudgetStrategy } from "../types.js"
import type { CompressionRate } from "../types.js"
import type { EmbeddingsProvider } from "../provider/embeddings.js"

const ALL_HIDDEN_TOOL_SCHEMAS: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "remember",
      description: "Expand compressed conversational memory",
      parameters: {
        type: "object",
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Semantic lookup across compressed history",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compress_memory",
      description: "Explicitly compresses a span or region",
      parameters: {
        type: "object",
        properties: {
          scope_id: { type: "string" },
          level: { type: "string", enum: ["light", "medium", "aggressive"] },
        },
        required: ["scope_id", "level"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expand_memory_range",
      description: "Rehydrates a contiguous region of transcript history",
      parameters: {
        type: "object",
        properties: {
          start_span: { type: "string" },
          end_span: { type: "string" },
        },
        required: ["start_span", "end_span"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pin_memory",
      description: "Marks memory as high-priority and non-compressible",
      parameters: {
        type: "object",
        properties: {
          memory_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["memory_id", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unpin_memory",
      description: "Removes protection from previously pinned memory",
      parameters: {
        type: "object",
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_memory_graph",
      description: "Graph-aware retrieval across memory relationships",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          depth: { type: "number" },
        },
        required: ["query", "depth"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "merge_memories",
      description: "Consolidates overlapping or redundant memory nodes",
      parameters: {
        type: "object",
        properties: {
          memory_ids: { type: "array", items: { type: "string" } },
        },
        required: ["memory_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "budget_context",
      description: "Controls how context is assembled for inference",
      parameters: {
        type: "object",
        properties: {
          strategy: { type: "string", enum: ["expand_recent", "preserve_old", "balanced", "task_focus"] },
        },
        required: ["strategy"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_memory_policy",
      description: "Adjusts global memory behavior dynamically",
      parameters: {
        type: "object",
        properties: {
          compression_rate: { type: "string", enum: ["low", "medium", "high"] },
          recency_bias: { type: "number" },
          retention_priority: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_memory_state",
      description: "Returns reasoning about memory transformations",
      parameters: {
        type: "object",
        properties: {
          memory_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_expansion_cost",
      description: "Estimates cost of expanding a memory region",
      parameters: {
        type: "object",
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_event",
      description: "Tags significant conversational events",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["decision", "fact", "task", "correction"] },
          content: { type: "string" },
        },
        required: ["type", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rebuild_context_window",
      description: "Forces full regeneration of working context",
      parameters: {
        type: "object",
        properties: {
          focus: { type: "string", enum: ["topic", "task", "span_id"] },
          value: { type: "string", description: "The focus value (topic name, task query, or span ID)" },
        },
        required: ["focus", "value"],
      },
    },
  },
]

function toInternalMessages(msgs: ChatCompletionRequest["messages"]): Message[] {
  return msgs.map((m, i) => {
    const parts: Message["content"] = []
    if (typeof m.content === "string") {
      parts.push({ type: "text", text: m.content })
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") parts.push({ type: "text", text: String(part.text) })
        else if (part.type === "image_url") parts.push({ type: "image_url", image_url: part.image_url as { url: string } })
      }
    }
    return {
      id: `msg_${Date.now()}_${i}`,
      role: m.role as Message["role"],
      content: parts,
      metadata: m.tool_call_id ? { tool_call_id: m.tool_call_id as string } : undefined,
    }
  })
}

function extractAuthToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1]
  }
  return process.env.TEST_USER_ID || null
}

function extractText(msg: Message): string {
  return msg.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("")
}

export function registerRoutes(
  app: FastifyInstance,
  store: IMemoryStore,
  globalProvider: Provider,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  embeddingsProvider?: EmbeddingsProvider,
  userStore?: IUserStore,
): void {
  app.get("/health", async () => ({ status: "ok" }))

  app.get("/metrics", async () => ({
    compression_ratio: 0,
    memory_expansion_rate: 0,
    average_token_savings: 0,
    summary_hit_rate: 0,
    provider_latency: 0,
    rehydration_frequency: 0,
    vector_store_size: (await vectorStore?.size()) ?? 0,
    registered_accounts: 0,
  }))

  if (userStore) {
    app.post<{ Body: RegisterRequest }>("/register", async (request, reply) => {
      const reqBody = request.body
      const apiKey = reqBody.api_key
      if (!apiKey) {
        return reply.status(400).send({ error: "api_key is required" })
      }

      const existingToken = extractAuthToken(request)
      const label = reqBody.label || reqBody.provider || "default"
      const providerType = reqBody.provider || "openai"
      const baseUrl = reqBody.base_url || "https://api.openai.com/v1"
      const defaultModel = reqBody.default_model || "gpt-4o"

      const config: ProviderConfig = {
        label,
        providerType,
        apiKey,
        baseUrl,
        defaultModel,
      }

      if (existingToken) {
        const account = await userStore.addProvider(existingToken, config)
        if (!account) {
          return reply.status(404).send({ error: "Token not found" })
        }
        const models = await userStore.listModels(existingToken)
        const resp: AddProviderResponse = {
          label,
          provider: providerType,
          default_model: defaultModel,
          models: models.map((m) => m.id),
        }
        return reply.status(201).send(resp)
      }

      const account = await userStore.createAccount(config)
      const models = await userStore.listModels(account.token)
      const resp: RegisterResponse = {
        token: account.token,
        label,
        provider: providerType,
        default_model: defaultModel,
        models: models.map((m) => m.id),
      }
      reply.status(201).send(resp)
    })

    app.get("/v1/models", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Authorization header required" })

      const models = await userStore.listModels(token)
      return reply.send({
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: m.owned_by,
        })),
      })
    })

    app.get("/providers", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      return reply.send({ providers: account.providers })
    })

    app.delete("/providers/:label", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const { label } = request.params as { label: string }
      const removed = await userStore.removeProvider(token, label)
      if (!removed) return reply.status(404).send({ error: `Provider '${label}' not found` })
      return reply.send({ removed: true, label })
    })

    app.get("/ui", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(WEB_UI_HTML)
    })

    app.get("/", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(WEB_UI_HTML)
    })

    app.post<{ Body: ChatCompletionRequest }>("/v1/chat/completions", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })

      const modelName = request.body.model
      const resolved = await userStore.resolveProvider(token, modelName)
      if (!resolved) {
        const account = await userStore.getAccount(token)
        if (!account) return reply.status(401).send({ error: "Invalid token" })
        return reply.status(400).send({
          error: `Unknown model '${modelName}'. Available models: ${account.providers.map((p) => `${p.label}/${p.defaultModel}`).join(", ")}`,
        })
      }

      const { provider: providerConfig, model } = resolved
      const chatBody = { ...request.body, model }
      const providers = createUserProviders(providerConfig)
      return handleChatRequest(chatBody, reply, store, providers.chat, engine, vectorStore, providers.embeddings, request)
    })

    return
  }

  app.get("/v1/models", async (_req, reply) => {
    return reply.send({
      object: "list",
      data: [
        { id: "gpt-4o", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "system" },
        { id: "gpt-4o-mini", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "system" },
      ],
    })
  })

  app.post<{ Body: ChatCompletionRequest }>("/v1/chat/completions", async (request, reply) => {
    const defaults = createFallbackProviders()
    return handleChatRequest(request.body, reply, store, defaults.chat, engine, vectorStore, defaults.embeddings, request)
  })
}

async function handleChatRequest(
  body: ChatCompletionRequest,
  reply: FastifyReply,
  store: IMemoryStore,
  provider: Provider,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  embeddingsProvider?: EmbeddingsProvider,
  request?: FastifyRequest,
): Promise<void> {
  const req = request!
  const convId = (body.messages[0] as Record<string, unknown>)?.conversation_id as string || `conv_${Date.now()}`
  const stream = body.stream ?? false

  const conv = await store.getOrCreateConversation(convId)
  const incomingMessages = toInternalMessages(body.messages)

  const budget = createBudget(body.max_tokens ? body.max_tokens * 4 : undefined)

  const assembled = engine.assemble(conv, incomingMessages, budget)

  const combinedMessages = [...assembled.systemMessages, ...assembled.workingMessages]

  const toolsWithHidden = [
    ...(body.tools as Array<Record<string, unknown>> || []),
    ...ALL_HIDDEN_TOOL_SCHEMAS,
  ]

  await compressConversation(conv, provider, embeddingsProvider, vectorStore)

  if (stream) {
    return handleStreaming(req, reply, conv, combinedMessages, toolsWithHidden, body, provider, store, engine, vectorStore)
  } else {
    return handleNonStreaming(reply, conv, combinedMessages, toolsWithHidden, body, provider, store, engine, vectorStore)
  }
}

async function handleStreaming(
  request: FastifyRequest,
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: ChatCompletionRequest,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const buffer = createStreamBuffer()
  const fullContent: string[] = []

  try {
    for await (const event of provider.chatStream({
      model: body.model,
      messages,
      tools,
      stream: true,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
    })) {
      appendToBuffer(buffer, event)

      if (event.type === "chunk" && typeof event.data === "string") {
        fullContent.push(event.data)
        reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
      } else if (event.type === "tool_call") {
        const toolCalls = Array.isArray(event.data) ? event.data : [event.data]
        for (const tc of toolCalls) {
          const name = tc.function?.name
          if (name) {
            await handleHiddenTool(conv, name, tc.function?.arguments || "{}", provider, messages, body, reply, fullContent, store, engine, vectorStore)
          }
        }
      } else if (event.type === "done") {
        reply.raw.write(serializeStreamDone())
      }
    }
  } catch (err) {
    console.error("Stream error:", err)
    reply.raw.write(serializeStreamDone())
  }

  reply.raw.end()

  const newMessages = createSpanMessages(body, fullContent.join(""))
  store.addSpan(conv, {
    id: `span_${Date.now()}`,
    messages: newMessages,
    createdAt: Date.now(),
    summaryIds: [],
    embeddingIds: [],
    tokenCount: Math.ceil(fullContent.join("").length / 4),
  })
  await store.saveConversation(conv)
}

async function handleNonStreaming(
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: ChatCompletionRequest,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
): Promise<void> {
  const maxReinferences = 3
  let reinferenceCount = 0
  let currentMessages = messages
  let finalContent = ""

  while (reinferenceCount < maxReinferences) {
    const response = await provider.chat({
      model: body.model,
      messages: currentMessages,
      tools,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
    })

    const toolCalls = response.message.content.filter((p) => p.type === "tool_call")
    if (toolCalls.length === 0) {
      finalContent = extractText(response.message)
      break
    }

    let needsReinference = false
    let toolResultText = ""
    for (const tc of toolCalls) {
      const name = tc.function.name
      const args = JSON.parse(tc.function.arguments)
      const result = await executeHiddenTool(conv, name, args, store, engine, vectorStore)
      if (result && result.needsReinference) {
        currentMessages = [...currentMessages, ...result.appendMessages]
        needsReinference = true
      }
      if (result && result.resultText) {
        toolResultText = result.resultText
      }
    }

    if (!needsReinference) {
      finalContent = toolResultText || "Tool executed."
      break
    }
    reinferenceCount++

    const newMessages = createSpanMessages(body, finalContent)
    store.addSpan(conv, {
      id: `span_${Date.now()}`,
      messages: newMessages,
      createdAt: Date.now(),
      summaryIds: [],
      embeddingIds: [],
      tokenCount: Math.ceil(finalContent.length / 4),
    })
    await store.saveConversation(conv)
  }

  store.addSpan(conv, {
    id: `span_${Date.now()}`,
    messages: createSpanMessages(body, finalContent),
    createdAt: Date.now(),
    summaryIds: [],
    embeddingIds: [],
    tokenCount: Math.ceil(finalContent.length / 4),
  })
  await store.saveConversation(conv)

  reply.send(JSON.parse(serializeNonStreamResponse(`chat_${Date.now()}`, body.model, finalContent)))
}

async function executeHiddenTool(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
): Promise<{ needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null> {
  switch (name) {
    case "remember": {
      const result = executeRemember(conv, args.memory_id as string)
      if (result.messages) {
        return { needsReinference: true, appendMessages: result.messages }
      }
      return { needsReinference: false, appendMessages: [], resultText: "Memory not found" }
    }

    case "search_memory": {
      const result = await executeSearch(conv, args.query as string, vectorStore)
      const label = result.semantic ? "Semantic search results" : "Search results (keyword fallback)"
      const text = `${label}:\n${result.matches.map((m) => `- ${m.id}: ${m.topic} (turns ${m.turnRange})`).join("\n")}`
      const toolMsg: Message = {
        id: `tool_${Date.now()}`,
        role: "tool",
        content: [{ type: "text", text }],
      }
      return { needsReinference: false, appendMessages: [toolMsg], resultText: text }
    }

    case "compress_memory": {
      const result = executeCompressMemory(conv, args.scope_id as string, args.level as CompressionLevel)
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "expand_memory_range": {
      const result = executeExpandMemoryRange(conv, args.start_span as string, args.end_span as string)
      if (result.messages.length > 0) {
        return { needsReinference: true, appendMessages: result.messages }
      }
      return { needsReinference: false, appendMessages: [], resultText: "No spans expanded" }
    }

    case "pin_memory": {
      const result = executePinMemory(conv, args.memory_id as string, (args.reason as string) || "User request")
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "unpin_memory": {
      const result = executeUnpinMemory(conv, args.memory_id as string)
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "query_memory_graph": {
      let result = executeQueryMemoryGraph(conv, args.query as string, (args.depth as number) || 1)
      if (vectorStore && result.memories.length === 0) {
        const scored = await vectorStore.searchMemories(args.query as string, conv.memories, 5)
        if (scored.length > 0) {
          result = executeQueryMemoryGraph(conv, scored.map((s) => s.handle.topic).join(" "), (args.depth as number) || 1)
        }
      }
      const text = `Memory graph: ${result.memories.length} memories, ${result.summaries.length} related summaries, ${result.events.length} related events`
      return { needsReinference: false, appendMessages: [], resultText: text }
    }

    case "merge_memories": {
      const result = executeMergeMemories(conv, args.memory_ids as string[])
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "budget_context": {
      const result = executeBudgetContext(conv, args.strategy as BudgetStrategy)
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "set_memory_policy": {
      const result = executeSetMemoryPolicy(conv, {
        compressionRate: args.compression_rate as CompressionRate,
        recencyBias: args.recency_bias as number,
        retentionPriority: args.retention_priority as string[],
      })
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "explain_memory_state": {
      const result = executeExplainMemoryState(conv, args.memory_id as string | undefined)
      const lines = result.transformations.join("\n")
      const t = result.tokenImpact
        ? `\nTokens: ${result.tokenImpact.originalTokens} original → ${result.tokenImpact.compressedTokens} compressed (saved ${result.tokenImpact.savings})`
        : ""
      return { needsReinference: false, appendMessages: [], resultText: `Memory state:\n${lines}${t}` }
    }

    case "simulate_expansion_cost": {
      const result = executeSimulateExpansionCost(conv, args.memory_id as string)
      return { needsReinference: false, appendMessages: [], resultText: result.recommendation }
    }

    case "mark_event": {
      const result = executeMarkEvent(conv, args.type as EventType, args.content as string)
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    case "rebuild_context_window": {
      const focusVal = (args.value as string) || (args.focus as string)
      const result = executeRebuildContextWindow(conv, args.focus as FocusType, focusVal)
      return { needsReinference: false, appendMessages: [], resultText: result.message }
    }

    default:
      return null
  }
}

async function handleHiddenTool(
  conv: Conversation,
  name: string,
  argsStr: string,
  provider: Provider,
  messages: Message[],
  body: ChatCompletionRequest,
  reply: FastifyReply,
  fullContent: string[],
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
): Promise<void> {
  const args = JSON.parse(argsStr)

  if (name === "remember") {
    const result = executeRemember(conv, args.memory_id)
    if (result.messages) {
      const reinferenceMessages = [...messages, ...result.messages]
      try {
        for await (const event of provider.chatStream({
          model: body.model,
          messages: reinferenceMessages,
          stream: true,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        })) {
          if (event.type === "chunk" && typeof event.data === "string") {
            fullContent.push(event.data)
            reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
          }
        }
      } catch (err) {
        console.error("Hidden reinference error:", err)
        const fallbackSummary = result.replacedSummary
        if (fallbackSummary) {
          const fallbackText = `[Memory recalled: ${fallbackSummary.summaryText}]`
          fullContent.push(fallbackText)
          reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, fallbackText))
        }
      }
    }
    return
  }

  const execResult = await executeHiddenTool(conv, name, args, store, engine, vectorStore)
  if (execResult && execResult.resultText) {
    fullContent.push(execResult.resultText)
    reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, execResult.resultText))

    if (execResult.needsReinference) {
      const reinferenceMessages = [...messages, ...execResult.appendMessages]
      try {
        for await (const event of provider.chatStream({
          model: body.model,
          messages: reinferenceMessages,
          stream: true,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        })) {
          if (event.type === "chunk" && typeof event.data === "string") {
            fullContent.push(event.data)
            reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
          }
        }
      } catch (err) {
        console.error("Hidden reinference error:", err)
      }
    }
  }
}

const WEB_UI_HTML = `<!DOCTYPE html>
<html lang="en" x-data="app()">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Provider Manager</title>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #f0f6fc; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 1rem; margin-bottom: 12px; color: #f0f6fc; }
  label { display: block; font-size: 0.8rem; color: #8b949e; margin-bottom: 4px; }
  input, select { width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem; margin-bottom: 12px; }
  input:focus, select:focus { outline: none; border-color: #58a6ff; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-danger { background: #da3633; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 0.75rem; color: #8b949e; text-transform: uppercase; padding-bottom: 8px; }
  td { padding: 8px 0; border-top: 1px solid #21262d; font-size: 0.9rem; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; background: #1f6feb22; color: #58a6ff; }
  .empty { color: #8b949e; font-style: italic; padding: 16px 0; text-align: center; }
  .provider-label { font-weight: 600; }
  .truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>

<h1>engramic</h1>
<p class="subtitle">Provider Manager</p>

<div class="card">
  <h2>Add Provider</h2>
  <label>Label</label>
  <input x-model="form.label" placeholder="e.g. openai, deepseek, anthropic">
  <label>Provider Type</label>
  <select x-model="form.providerType">
    <option value="openai">OpenAI Compatible</option>
    <option value="anthropic">Anthropic</option>
  </select>
  <label>API Key</label>
  <input x-model="form.apiKey" type="password" placeholder="sk-...">
  <label>Base URL</label>
  <input x-model="form.baseUrl" placeholder="https://api.openai.com/v1">
  <label>Default Model</label>
  <input x-model="form.defaultModel" placeholder="gpt-4o">
  <button class="btn btn-primary" x-on:click="addProvider()" x-text="saving ? 'Saving...' : 'Add Provider'" :disabled="saving"></button>
</div>

<div class="card">
  <h2>Providers</h2>
  <template x-if="!loaded">
    <p class="empty">Loading...</p>
  </template>
  <template x-if="loaded && providers.length === 0">
    <p class="empty">No providers configured</p>
  </template>
  <table x-show="loaded && providers.length > 0">
    <thead><tr><th>Label</th><th>Type</th><th>Model</th><th>Base URL</th><th></th></tr></thead>
    <tbody>
      <template x-for="p in providers" :key="p.label">
        <tr>
          <td class="provider-label" x-text="p.label"></td>
          <td><span class="badge" x-text="p.providerType"></span></td>
          <td class="truncate" x-text="p.defaultModel"></td>
          <td class="truncate" x-text="p.baseUrl"></td>
          <td><button class="btn btn-danger" x-on:click="removeProvider(p.label)">Remove</button></td>
        </tr>
      </template>
    </tbody>
  </table>
</div>

<div
  x-show="toast.show"
  x-text="toast.message"
  :class="'toast ' + toast.type"
  style="position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; color: #fff; font-size: 0.85rem; cursor: pointer"
  x-on:click="toast.show = false"
></div>

<style>
  .toast.ok { background: #238636; }
  .toast.err { background: #da3633; }
</style>

<script>
document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    providers: [],
    loaded: false,
    saving: false,
    toast: { show: false, message: "", type: "ok" },
    form: {
      label: "default",
      providerType: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
    },
    async init() {
      await this.loadProviders()
    },
    async api(path, opts = {}) {
      const res = await fetch(window.location.origin + path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      return data
    },
    notify(msg, type = "ok") {
      this.toast = { show: true, message: msg, type }
      setTimeout(() => { if (this.toast.message === msg) this.toast.show = false }, 3000)
    },
    async loadProviders() {
      try {
        const data = await this.api("/providers")
        this.providers = data.providers || []
      } catch (e) {
        this.notify(e.message, "err")
      }
      this.loaded = true
    },
    async addProvider() {
      const f = this.form
      if (!f.label || !f.apiKey) { this.notify("Label and API key are required", "err"); return }
      this.saving = true
      try {
        await this.api("/register", {
          method: "POST",
          body: JSON.stringify({
            label: f.label,
            api_key: f.apiKey,
            base_url: f.baseUrl,
            default_model: f.defaultModel,
            provider: f.providerType,
          }),
        })
        this.notify("Provider added")
        f.apiKey = ""
        await this.loadProviders()
      } catch (e) {
        this.notify(e.message, "err")
      }
      this.saving = false
    },
    async removeProvider(label) {
      if (!confirm(\`Remove provider "\${label}"?\`)) return
      try {
        await this.api("/providers/" + encodeURIComponent(label), { method: "DELETE" })
        this.notify("Provider removed")
        await this.loadProviders()
      } catch (e) {
        this.notify(e.message, "err")
      }
    },
  }))
})
</script>
</body>
</html>`

function createSpanMessages(body: ChatCompletionRequest, assistantContent: string): Message[] {
  const msgs = toInternalMessages(body.messages)
  if (assistantContent) {
    msgs.push({
      id: `msg_${Date.now()}_assistant`,
      role: "assistant",
      content: [{ type: "text", text: assistantContent }],
    })
  }
  return msgs
}
