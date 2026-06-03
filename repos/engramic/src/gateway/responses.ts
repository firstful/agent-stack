import type { FastifyReply, FastifyRequest } from "fastify"
import type {
  ChatCompletionRequest,
  Conversation,
  Message,
  ProviderResponse,
  ProviderStreamEvent,
  ResponsesApiRequest,
  ResponseOutputItem,
  ResponseFunctionCall,
  TokenBudget,
  UsageRecord,
} from "../types.js"
import { inputToMessages } from "../types.js"
import type { IMemoryStore } from "../memory/store.js"
import type { IVectorStore } from "../memory/vector.js"
import type { IUserStore } from "../auth/user-store.js"
import type { IUsageStore } from "../usage/store.js"
import { PricingEngine } from "../usage/pricing.js"
import { MetricsCollector } from "../usage/metrics.js"
import { randomUUID } from "node:crypto"
import { Provider } from "../provider/index.js"
import { ContextEngine, createBudget } from "../context/engine.js"
import { compressConversation } from "../context/compression.js"
import type { EmbeddingsProvider } from "../provider/embeddings.js"
import {
  executeRemember,
  executeSearch,
  executeCompressMemory,
  executeExpandMemoryRange,
  executePinMemory,
  executeUnpinMemory,
  executeQueryMemoryGraph,
  executeMergeMemories,
  executeBudgetContext,
  executeSetMemoryPolicy,
  executeExplainMemoryState,
  executeSimulateExpansionCost,
  executeMarkEvent,
  executeRebuildContextWindow,
} from "./hidden-tools.js"
import type { CompressionLevel } from "../tools/compress_memory.js"
import type { EventType } from "../tools/mark_event.js"
import type { FocusType } from "../tools/rebuild_context_window.js"
import type { BudgetStrategy, CompressionRate, HiddenToolName } from "../types.js"
import { HIDDEN_TOOLS } from "../types.js"

// ── Serializers ──

function serializeResponseId(): string {
  return `resp_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function serializeMessageId(): string {
  return `msg_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function serializeFunctionCallId(): string {
  return `fc_${Date.now()}_${randomUUID().slice(0, 8)}`
}

function buildResponse(
  id: string,
  model: string,
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  functionCalls?: ResponseFunctionCall[],
  metadata?: Record<string, unknown>,
): string {
  const output: ResponseOutputItem[] = []
  if (content) {
    output.push({
      type: "message",
      id: serializeMessageId(),
      role: "assistant",
      content: [{ type: "output_text", text: content }],
    })
  }
  if (functionCalls && functionCalls.length > 0) {
    for (const fc of functionCalls) {
      output.push(fc)
    }
  }
  const body: Record<string, unknown> = {
    id,
    object: "response",
    created: Math.floor(Date.now() / 1000),
    model,
    output,
  }
  if (usage) {
    body.usage = {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    }
  }
  if (metadata && Object.keys(metadata).length > 0) {
    body.metadata = metadata
  }
  return JSON.stringify(body)
}

function buildStreamChunk(
  responseId: string,
  model: string,
  contentDelta: string,
  index: number,
): string {
  return `data: ${JSON.stringify({
    type: "response.output_text.delta",
    item_id: `msg_${responseId}`,
    output_index: index,
    delta: contentDelta,
  })}\n\n`
}

function buildStreamContentDone(responseId: string, model: string, index: number): string {
  return `data: ${JSON.stringify({
    type: "response.output_text.done",
    item_id: `msg_${responseId}`,
    output_index: index,
  })}\n\n`
}

function buildStreamResponseCompleted(
  responseId: string,
  model: string,
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  functionCalls?: ResponseFunctionCall[],
  metadata?: Record<string, unknown>,
): string {
  const output: ResponseOutputItem[] = []
  if (content) {
    output.push({
      type: "message",
      id: serializeMessageId(),
      role: "assistant",
      content: [{ type: "output_text", text: content }],
    })
  }
  if (functionCalls && functionCalls.length > 0) {
    for (const fc of functionCalls) {
      output.push(fc)
    }
  }
  const body: Record<string, unknown> = {
    id: responseId,
    object: "response",
    created: Math.floor(Date.now() / 1000),
    model,
    output,
  }
  if (usage) {
    body.usage = {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    }
  }
  if (metadata && Object.keys(metadata).length > 0) {
    body.metadata = metadata
  }
  return `data: ${JSON.stringify(body)}\n\n`
}

function buildStreamDone(): string {
  return "data: [DONE]\n\n"
}

// ── Internal helpers ──

function toInternalMessages(
  msgs: Array<{ role: string; content: string | Array<Record<string, unknown>>; [key: string]: unknown }>,
): Message[] {
  return msgs.map((m, i) => {
    const parts: Message["content"] = []
    if (typeof m.content === "string") {
      parts.push({ type: "text", text: m.content })
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") parts.push({ type: "text", text: String(part.text) })
        else if (part.type === "image_url")
          parts.push({ type: "image_url", image_url: part.image_url as { url: string } })
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

function extractText(msg: Message): string {
  return msg.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

function recordToolCall(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  result: string,
): void {
  conv.toolCalls.push({ name, arguments: args, result, timestamp: Date.now() })
}

function createSpanMessages(
  input: ResponsesApiRequest["input"],
  assistantContent: string,
): Message[] {
  const rawMsgs = inputToMessages(input)
  const msgs = toInternalMessages(rawMsgs)
  if (assistantContent) {
    msgs.push({
      id: `msg_${Date.now()}_assistant`,
      role: "assistant",
      content: [{ type: "text", text: assistantContent }],
    })
  }
  return msgs
}

// ── Hidden tool execution ──

async function executeHiddenTool(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  userStore?: IUserStore,
  userId?: string,
  summarizationProvider?: Provider,
  summarizationModel?: string,
): Promise<{ needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null> {
  let result: {
    needsReinference: boolean
    appendMessages: Message[]
    resultText?: string
  } | null = null

  switch (name) {
    case "remember": {
      const r = await executeRemember(conv, args.memory_id as string, userStore, userId)
      if (r.messages) {
        result = { needsReinference: true, appendMessages: r.messages }
      } else {
        result = { needsReinference: false, appendMessages: [], resultText: "Memory not found" }
      }
      break
    }

    case "search_memory": {
      const r = await executeSearch(conv, args.query as string, vectorStore, userStore, userId)
      const label = r.semantic ? "Semantic search results" : "Search results (keyword fallback)"
      const text = `${label}:\n${r.matches.map((m) => `- ${m.id}: ${m.topic} (turns ${m.turnRange})`).join("\n")}`
      const toolMsg: Message = {
        id: `tool_${Date.now()}`,
        role: "tool",
        content: [{ type: "text", text }],
      }
      result = { needsReinference: false, appendMessages: [toolMsg], resultText: text }
      break
    }

    case "compress_memory": {
      const r = await executeCompressMemory(
        conv,
        args.scope_id as string,
        args.level as CompressionLevel,
        summarizationProvider,
        summarizationModel,
      )
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "expand_memory_range": {
      const r = executeExpandMemoryRange(conv, args.start_span as string, args.end_span as string)
      if (r.messages.length > 0) {
        result = { needsReinference: true, appendMessages: r.messages }
      } else {
        result = {
          needsReinference: false,
          appendMessages: [],
          resultText: "No spans expanded",
        }
      }
      break
    }

    case "pin_memory": {
      const r = executePinMemory(conv, args.memory_id as string, (args.reason as string) || "User request")
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "unpin_memory": {
      const r = executeUnpinMemory(conv, args.memory_id as string)
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "query_memory_graph": {
      let r = executeQueryMemoryGraph(conv, args.query as string, (args.depth as number) || 1)
      if (vectorStore && r.memories.length === 0) {
        const scored = await vectorStore.searchMemories(args.query as string, conv.memories, 5)
        if (scored.length > 0) {
          r = executeQueryMemoryGraph(
            conv,
            scored.map((s) => s.handle.topic).join(" "),
            (args.depth as number) || 1,
          )
        }
      }
      const text = `Memory graph: ${r.memories.length} memories, ${r.summaries.length} related summaries, ${r.events.length} related events`
      result = { needsReinference: false, appendMessages: [], resultText: text }
      break
    }

    case "merge_memories": {
      const r = executeMergeMemories(conv, args.memory_ids as string[])
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "budget_context": {
      const r = executeBudgetContext(conv, args.strategy as BudgetStrategy)
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "set_memory_policy": {
      const r = executeSetMemoryPolicy(conv, {
        compressionRate: args.compression_rate as CompressionRate,
        recencyBias: args.recency_bias as number,
        retentionPriority: args.retention_priority as string[],
      })
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "explain_memory_state": {
      const r = executeExplainMemoryState(conv, args.memory_id as string | undefined)
      const lines = r.transformations.join("\n")
      const t = r.tokenImpact
        ? `\nTokens: ${r.tokenImpact.originalTokens} original → ${r.tokenImpact.compressedTokens} compressed (saved ${r.tokenImpact.savings})`
        : ""
      result = { needsReinference: false, appendMessages: [], resultText: `Memory state:\n${lines}${t}` }
      break
    }

    case "simulate_expansion_cost": {
      const r = executeSimulateExpansionCost(conv, args.memory_id as string)
      result = { needsReinference: false, appendMessages: [], resultText: r.recommendation }
      break
    }

    case "mark_event": {
      const r = executeMarkEvent(conv, args.type as EventType, args.content as string)
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "rebuild_context_window": {
      const focusVal = (args.value as string) || (args.focus as string)
      const r = executeRebuildContextWindow(conv, args.focus as FocusType, focusVal)
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    default:
      return null
  }

  recordToolCall(conv, name, args, result?.resultText || "")
  return result
}

// ── Hidden tool schemas ──

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
  {
    type: "function",
    function: {
      name: "predictive_prefetch",
      description: "Pre-expand memory spans predicted to be needed based on conversation trajectory",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional query to bias predictions toward matching topics" },
          depth: { type: "number", description: "How many spans to try prefetching (1-10, default from config)" },
        },
      },
    },
  },
]

// ── Main handler ──

export async function handleResponsesRequest(
  body: ResponsesApiRequest,
  reply: FastifyReply,
  store: IMemoryStore,
  provider: Provider,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  embeddingsProvider?: EmbeddingsProvider,
  userId?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
  summarizationProvider?: Provider,
  summarizationModel?: string,
  userStore?: IUserStore,
): Promise<void> {
  const rawMessages = inputToMessages(body.input)
  const convId =
    (rawMessages[0] as Record<string, unknown>)?.conversation_id as string ||
    body.previous_response_id ||
    `conv_${Date.now()}`
  const stream = body.stream ?? false
  const model = body.model

  const conv = await store.getOrCreateConversation(convId)
  const incomingMessages = toInternalMessages(rawMessages)

  // If instructions are provided, prepend as system message
  if (body.instructions) {
    incomingMessages.unshift({
      id: `msg_${Date.now()}_instructions`,
      role: "system",
      content: [{ type: "text", text: body.instructions }],
    })
  }

  const budget = createBudget(body.max_output_tokens ? body.max_output_tokens * 4 : undefined)

  const assembled = engine.assemble(conv, incomingMessages, budget)
  const combinedMessages = [...assembled.systemMessages, ...assembled.workingMessages]

  const toolsWithHidden = [
    ...((body.tools as Array<Record<string, unknown>>) || []),
    ...ALL_HIDDEN_TOOL_SCHEMAS,
  ]

  const newMemory = await compressConversation(
    conv,
    summarizationProvider || provider,
    summarizationModel || "gpt-4o-mini",
    embeddingsProvider,
    vectorStore,
  )

  if (newMemory && userStore && userId) {
    await userStore.addAccountMemory(userId, newMemory)
  }

  metricsCollector?.recordRequest()

  if (stream) {
    return handleResponsesStreaming(
      reply,
      conv,
      combinedMessages,
      toolsWithHidden,
      body,
      provider,
      store,
      engine,
      vectorStore,
      userId,
      model,
      providerLabel,
      usageStore,
      metricsCollector,
      userStore,
      summarizationProvider,
      summarizationModel,
    )
  } else {
    return handleResponsesNonStreaming(
      reply,
      conv,
      combinedMessages,
      toolsWithHidden,
      body,
      provider,
      store,
      engine,
      vectorStore,
      userId,
      model,
      providerLabel,
      usageStore,
      metricsCollector,
      userStore,
      summarizationProvider,
      summarizationModel,
    )
  }
}

// ── Non-streaming handler ──

async function handleResponsesNonStreaming(
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: ResponsesApiRequest,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  userId?: string,
  modelName?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
  userStore?: IUserStore,
  summarizationProvider?: Provider,
  summarizationModel?: string,
): Promise<void> {
  const responseId = serializeResponseId()
  const maxReinferences = 3
  let reinferenceCount = 0
  let currentMessages = messages
  let finalContent = ""
  let finalUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null =
    null
  let userFunctionCalls: ResponseFunctionCall[] = []
  const startTime = Date.now()
  const pricing = new PricingEngine()
  const model = modelName || body.model
  const responseMetadata = body.metadata as Record<string, unknown> | undefined

  while (reinferenceCount < maxReinferences) {
    const response = await provider.chat({
      model: body.model,
      messages: currentMessages,
      tools,
      max_tokens: body.max_output_tokens,
      temperature: body.temperature,
      response_format: body.response_format,
      parallel_tool_calls: body.parallel_tool_calls,
      tool_choice: body.tool_choice,
    })

    if (usageStore && userId) {
      const usage: UsageRecord = {
        id: randomUUID(),
        userId,
        conversationId: conv.id,
        model,
        providerLabel: providerLabel || "default",
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        cost: pricing.computeCost(
          model,
          response.usage?.prompt_tokens ?? 0,
          response.usage?.completion_tokens ?? 0,
        ),
        createdAt: Date.now(),
      }
      usageStore.record(usage)
    }

    finalUsage = response.usage ?? null

    const allToolCalls = response.message.content.filter((p) => p.type === "tool_call")
    const hiddenToolCalls = allToolCalls.filter(
      (tc) => HIDDEN_TOOLS.includes(tc.function.name as HiddenToolName),
    )
    const userToolCalls = allToolCalls.filter(
      (tc) => !HIDDEN_TOOLS.includes(tc.function.name as HiddenToolName),
    )

    // Surface user-facing tool calls as function_call output items
    if (userToolCalls.length > 0) {
      userFunctionCalls = userToolCalls.map((tc) => ({
        type: "function_call" as const,
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed" as const,
      }))
    }

    if (hiddenToolCalls.length === 0) {
      finalContent = extractText(response.message)
      break
    }

    let needsReinference = false
    let toolResultText = ""
    for (const tc of hiddenToolCalls) {
      const name = tc.function.name
      const args = JSON.parse(tc.function.arguments)
      const result = await executeHiddenTool(
        conv,
        name,
        args,
        store,
        engine,
        vectorStore,
        userStore,
        userId,
        summarizationProvider,
        summarizationModel,
      )
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
  }

  const latency = Date.now() - startTime
  metricsCollector?.recordLatency(latency)

  // Save conversation span
  const spanMsgs = createSpanMessages(body.input, finalContent)
  store.addSpan(conv, {
    id: `span_${Date.now()}`,
    messages: spanMsgs,
    createdAt: Date.now(),
    summaryIds: [],
    embeddingIds: [],
    tokenCount: Math.ceil(finalContent.length / 4),
  })
  await store.saveConversation(conv)

  reply.header("Content-Type", "application/json")
  reply.send(
    buildResponse(responseId, model, finalContent, finalUsage, userFunctionCalls, responseMetadata),
  )
}

// ── Streaming handler ──

async function handleResponsesStreaming(
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: ResponsesApiRequest,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  userId?: string,
  modelName?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
  userStore?: IUserStore,
  summarizationProvider?: Provider,
  summarizationModel?: string,
): Promise<void> {
  const responseId = serializeResponseId()
  const MAX_PASSES = 3

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const startTime = Date.now()
  const pricing = new PricingEngine()
  const resolvedModel = modelName || body.model
  const responseMetadata = body.metadata as Record<string, unknown> | undefined

  let currentMessages = messages
  let finalContent = ""
  let finalUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null =
    null
  let userFunctionCalls: ResponseFunctionCall[] = []

  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passEvents: ProviderStreamEvent[] = []
      let passContent = ""
      let passUsage: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      } | null = null
      let hasToolCalls = false

      try {
        for await (const event of provider.chatStream({
          model: body.model,
          messages: currentMessages,
          tools,
          stream: true,
          max_tokens: body.max_output_tokens,
          temperature: body.temperature,
          response_format: body.response_format,
          parallel_tool_calls: body.parallel_tool_calls,
          tool_choice: body.tool_choice,
        })) {
          passEvents.push(event)
          if (event.type === "usage") {
            passUsage = event.data as {
              prompt_tokens: number
              completion_tokens: number
              total_tokens: number
            }
          } else if (event.type === "chunk" && typeof event.data === "string") {
            passContent += event.data
          } else if (event.type === "tool_call") {
            hasToolCalls = true
          }
        }
      } catch (err) {
        console.error(`Responses stream pass ${pass + 1} error:`, err)
        finalContent = passContent
        finalUsage = passUsage
        break
      }

      // Record usage for every pass
      if (usageStore && userId && resolvedModel && passUsage) {
        usageStore.record({
          id: randomUUID(),
          userId,
          conversationId: conv.id,
          model: resolvedModel,
          providerLabel: providerLabel || "default",
          promptTokens: passUsage.prompt_tokens,
          completionTokens: passUsage.completion_tokens,
          totalTokens: passUsage.total_tokens,
          cost: pricing.computeCost(
            resolvedModel,
            passUsage.prompt_tokens,
            passUsage.completion_tokens,
          ),
          createdAt: Date.now(),
        })
      }

      if (!hasToolCalls) {
        finalContent = passContent
        finalUsage = passUsage
        break
      }

      // Check for user-facing vs hidden tool calls
      const toolCallEvents = passEvents.filter((e: any) => e.type === "tool_call")
      const allToolCallData: Array<{
        id: string
        function: { name: string; arguments: string }
      }> = []
      for (const tcEvent of toolCallEvents) {
        const tcs = Array.isArray(tcEvent.data) ? tcEvent.data : [tcEvent.data]
        for (const tc of tcs) {
          if (tc.function?.name) {
            allToolCallData.push({
              id: tc.id,
              function: { name: tc.function.name, arguments: tc.function.arguments || "{}" },
            })
          }
        }
      }

      const hiddenCalls = allToolCallData.filter((tc) =>
        HIDDEN_TOOLS.includes(tc.function.name as HiddenToolName),
      )
      const userCalls = allToolCallData.filter(
        (tc) => !HIDDEN_TOOLS.includes(tc.function.name as HiddenToolName),
      )

      // Surface user-facing tool calls
      if (userCalls.length > 0) {
        userFunctionCalls = userCalls.map((tc) => ({
          type: "function_call" as const,
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: "completed" as const,
        }))
      }

      if (hiddenCalls.length === 0) {
        finalContent = passContent
        finalUsage = passUsage
        break
      }

      // Execute hidden tools from this pass
      let needsReinference = false
      for (const tc of hiddenCalls) {
        const name = tc.function.name
        const args = JSON.parse(tc.function.arguments || "{}")
        const result = await executeHiddenTool(
          conv,
          name,
          args,
          store,
          engine,
          vectorStore,
          userStore,
          userId,
          summarizationProvider,
          summarizationModel,
        )
        if (result) {
          recordToolCall(conv, name, args, result.resultText || "")
          if (result.appendMessages.length > 0) {
            currentMessages = [...currentMessages, ...result.appendMessages]
            needsReinference = true
          }
        }
      }

      if (!needsReinference || pass === MAX_PASSES - 1) {
        finalContent = passContent
        finalUsage = passUsage
        if (pass === MAX_PASSES - 1) {
          console.warn("Max streaming reinference passes reached")
        }
        break
      }
    }

    // Stream the Responses API chunks
    if (finalContent) {
      // Stream content as output_text chunks
      const chunkSize = 50
      for (let i = 0; i < finalContent.length; i += chunkSize) {
        reply.raw.write(
          buildStreamChunk(responseId, resolvedModel, finalContent.slice(i, i + chunkSize), 0),
        )
      }
      reply.raw.write(buildStreamContentDone(responseId, resolvedModel, 0))
    }
    reply.raw.write(
      buildStreamResponseCompleted(
        responseId, resolvedModel, finalContent, finalUsage, userFunctionCalls, responseMetadata,
      ),
    )
    reply.raw.write(buildStreamDone())
  } catch (err) {
    console.error("Responses stream error:", err)
    reply.raw.write(buildStreamDone())
  }

  reply.raw.end()

  const latency = Date.now() - startTime
  metricsCollector?.recordLatency(latency)

  const newMessages = createSpanMessages(body.input, finalContent)
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
