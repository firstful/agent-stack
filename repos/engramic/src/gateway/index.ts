import type { FastifyReply, FastifyRequest } from "fastify"
import type {
  ChatCompletionRequest,
  Conversation,
  Message,
  TranscriptSpan,
  TokenBudget,
  UsageRecord,
  ProfileCompression,
  CompressionRate,
  CompressionStrategy,
  MemoryPolicy,
} from "../types.js"
import { HIDDEN_TOOLS, DEFAULT_RETENTION_POLICY } from "../types.js"
import type { IMemoryStore } from "../memory/store.js"
import type { IVectorStore } from "../memory/vector.js"
import type { IUserStore } from "../auth/user-store.js"
import type { IUsageStore } from "../usage/store.js"
import type { EmbeddingsProvider } from "../provider/embeddings.js"
import { PricingEngine } from "../usage/pricing.js"
import { MetricsCollector } from "../usage/metrics.js"
import { randomUUID } from "node:crypto"
import { Provider } from "../provider/index.js"
import { ContextEngine, createBudget } from "../context/engine.js"
import { compressConversation } from "../context/compression.js"
import { createUserProviders, createFallbackProviders, createProfileProviders } from "../auth/provider-factory.js"
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
  executePredictivePrefetch,
} from "./hidden-tools.js"
import type { CompressionLevel } from "../tools/compress_memory.js"
import type { EventType } from "../tools/mark_event.js"
import type { FocusType } from "../tools/rebuild_context_window.js"
import type { BudgetStrategy } from "../types.js"
import { serializeNonStreamResponse, serializeStreamChunk, serializeStreamDone } from "./stream.js"

// ── Helpers ──

function extractAuthToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1]
  }
  return (process.env.TEST_USER_ID as string) || null
}

function extractText(msg: Message): string {
  return msg.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

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
          parts.push({ type: "image_url", image_url: part.image_url as { url: string; detail?: string } })
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

function recordToolCall(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  result: string,
): void {
  conv.toolCalls.push({ name, arguments: args, result, timestamp: Date.now() })
}

function createSpanMessages(
  body: { messages: Array<Record<string, unknown>>; instructions?: string },
  assistantContent: string,
): Message[] {
  const raw = body.messages || []
  const msgs = toInternalMessages(raw as Array<{ role: string; content: string | Array<Record<string, unknown>> }>)
  if (assistantContent) {
    msgs.push({
      id: `msg_${Date.now()}_assistant`,
      role: "assistant",
      content: [{ type: "text", text: assistantContent }],
    })
  }
  return msgs
}

// ── Profile compression → conversation policy bridge ──

/**
 * Maps ProfileCompression (trigger+threshold+rate) to the conversation's MemoryPolicy.
 * Called when a profile-scoped chat request starts, so the adaptive compression
 * system uses the profile's configured preferences.
 */
function applyProfileCompressionToConversation(
  conv: Conversation,
  profileCompression: ProfileCompression,
): void {
  const update: Partial<MemoryPolicy> = {}

  // Map the profile compression trigger to the appropriate strategy
  switch (profileCompression.trigger) {
    case "token_count":
      update.compressionStrategy = "token_count"
      update.tokenThreshold = profileCompression.threshold
      break
    case "message_count":
      update.compressionStrategy = "age"
      update.messageThreshold = profileCompression.threshold
      break
    case "idle_time":
      update.compressionStrategy = "age"
      update.idleThresholdMs = profileCompression.threshold
      break
  }

  // Map rate
  update.compressionRate = profileCompression.rate

  conv.policy = { ...conv.policy, ...update }
  conv.updatedAt = Date.now()
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
      description: "Adjusts global memory behavior dynamically — compression strategy, rate, thresholds",
      parameters: {
        type: "object",
        properties: {
          compression_strategy: { type: "string", enum: ["token_count", "age", "semantic_distance", "auto"] },
          compression_rate: { type: "string", enum: ["low", "medium", "high"] },
          recency_bias: { type: "number" },
          retention_priority: { type: "array", items: { type: "string" } },
          token_threshold: { type: "number" },
          message_threshold: { type: "number" },
          idle_threshold_ms: { type: "number" },
          semantic_distance_threshold: { type: "number" },
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

// ── Route registration ──

export function registerRoutes(
  app: any,
  store: IMemoryStore,
  globalProvider: Provider,
  engine: ContextEngine,
  vectorStore: IVectorStore,
  embeddingsProvider: EmbeddingsProvider,
  userStore: IUserStore,
  usageStore: IUsageStore,
  metricsCollector: MetricsCollector,
): void {
  app.get("/health", async () => ({ status: "ok" }))

  app.get("/metrics", async () => {
    const metrics = metricsCollector?.snapshot()
    const global = await usageStore?.getGlobalSummary()
    return {
      total_requests: global?.requestCount ?? 0,
      total_prompt_tokens: global?.totalPromptTokens ?? 0,
      total_completion_tokens: global?.totalCompletionTokens ?? 0,
      total_tokens: (global?.totalPromptTokens ?? 0) + (global?.totalCompletionTokens ?? 0),
      total_cost_usd: global?.totalCost ?? 0,
      by_model: global?.byModel ?? {},
      compression_ratio: metrics?.compressionRatio ?? 0,
      memory_expansion_rate: metrics?.memoryExpansionRate ?? 0,
      average_token_savings: metrics?.averageTokenSavings ?? 0,
      summary_hit_rate: metrics?.summaryHitRate ?? 0,
      provider_latency: metrics?.providerLatency ?? 0,
      rehydration_frequency: metrics?.rehydrationFrequency ?? 0,
      vector_store_size: (await vectorStore?.size()) ?? 0,
      registered_accounts: 0,
    }
  })

  app.get("/api/conversations", async (_request: FastifyRequest, reply: FastifyReply) => {
    const ids = await store.listConversationIds()
    const conversations = []
    for (const id of ids) {
      const conv = await store.getOrCreateConversation(id)
      const lastSpan = conv.spans[conv.spans.length - 1]
      const lastText = lastSpan ? lastSpan.messages.filter((m) => m.role === "assistant").pop() : undefined
      conversations.push({
        id: conv.id,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        spanCount: conv.spans.length,
        messageCount: conv.spans.reduce((s, sp) => s + sp.messages.length, 0),
        toolCallCount: conv.toolCalls.length,
        preview: lastText ? extractText(lastText).slice(0, 120) : "",
      })
    }
    conversations.sort((a, b) => b.updatedAt - a.updatedAt)
    return reply.send({ conversations })
  })

  app.get("/api/conversations/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }
    const conv = await store.getOrCreateConversation(id)
    const timeline: Array<Record<string, unknown>> = []

    for (let si = 0; si < conv.spans.length; si++) {
      const span = conv.spans[si]
      for (const msg of span.messages) {
        if (msg.role === "user" || msg.role === "assistant" || msg.role === "system") {
          timeline.push({
            type: msg.role,
            role: msg.role,
            content: extractText(msg),
            spanIndex: si,
            timestamp: span.createdAt,
          })
        }
      }
    }
    for (const tc of conv.toolCalls) {
      timeline.push({
        type: "hidden",
        toolName: tc.name,
        arguments: tc.arguments,
        result: tc.result,
        timestamp: tc.timestamp,
      })
    }
    for (const se of conv.systemEvents) {
      timeline.push({
        type: se.type,
        description: se.description,
        details: se.details,
        timestamp: se.timestamp,
      })
    }
    timeline.sort((a, b) => (a.timestamp as number) - (b.timestamp as number))

    return reply.send({
      id: conv.id,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      spanCount: conv.spans.length,
      timeline,
    })
  })

  app.get("/chats", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Content-Type", "text/html; charset=utf-8")
    return reply.send(CHATS_UI_HTML)
  })

  if (usageStore) {
    app.get("/v1/usage", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const sinceQuery = (request.query as Record<string, string>).since
      const since = sinceQuery ? parseInt(sinceQuery, 10) : undefined
      const summary = await usageStore.getSummary(token, since)
      return reply.send({
        total_prompt_tokens: summary.totalPromptTokens,
        total_completion_tokens: summary.totalCompletionTokens,
        total_tokens: summary.totalPromptTokens + summary.totalCompletionTokens,
        total_cost_usd: summary.totalCost,
        request_count: summary.requestCount,
        by_model: summary.byModel,
      })
    })

    app.get("/v1/usage/records", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const sinceQuery = (request.query as Record<string, string>).since
      const since = sinceQuery ? parseInt(sinceQuery, 10) : undefined
      const records = await usageStore.getByUser(token, since)
      return reply.send({ records })
    })
  }

  if (userStore) {
    app.post("/register", async (request: FastifyRequest, reply: FastifyReply) => {
      const reqBody = request.body as Record<string, unknown>
      const apiKey = reqBody.api_key as string
      if (!apiKey) {
        return reply.status(400).send({ error: "api_key is required" })
      }
      const existingToken = extractAuthToken(request)
      const label = (reqBody.label as string) || (reqBody.provider as string) || "default"
      const providerType = (reqBody.provider as string) || "openai"
      const baseUrl = (reqBody.base_url as string) || "https://api.openai.com/v1"
      const defaultModel = (reqBody.default_model as string) || "gpt-4o"
      const config = { label, providerType, apiKey, baseUrl, defaultModel }

      if (existingToken) {
        const account = await userStore.addProvider(existingToken, config)
        if (!account) {
          return reply.status(404).send({ error: "Token not found" })
        }
        const models = await userStore.listModels(existingToken)
        return reply.status(201).send({
          label,
          provider: providerType,
          default_model: defaultModel,
          models: models.map((m) => m.id),
        })
      }

      const account = await userStore.createAccount(config)
      const models = await userStore.listModels(account.token)
      return reply.status(201).send({
        token: account.token,
        label,
        provider: providerType,
        default_model: defaultModel,
        models: models.map((m) => m.id),
      })
    })

    app.get("/v1/models", async (request: FastifyRequest, reply: FastifyReply) => {
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

    app.get("/providers", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      return reply.send({ providers: account.providers })
    })

    app.post("/test-provider", async (request: FastifyRequest, reply: FastifyReply) => {
      const { base_url, api_key } = request.body as { base_url?: string; api_key?: string }
      if (!api_key || !base_url) {
        return reply.status(400).send({ ok: false, error: "base_url and api_key are required" })
      }
      let modelsUrl = base_url.endsWith("/v1") ? `${base_url}/models` : `${base_url.replace(/\/+$/, "")}/v1/models`
      try {
        const res = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${api_key}` } })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return reply.send({ ok: false, error: `Provider returned ${res.status}: ${text.slice(0, 200)}` })
        }
        const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (data.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by || "unknown" }))
        return reply.send({ ok: true, models })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    app.post("/test-chat", async (request: FastifyRequest, reply: FastifyReply) => {
      const { base_url, api_key, model } = request.body as { base_url?: string; api_key?: string; model?: string }
      if (!api_key || !base_url || !model) {
        return reply.status(400).send({ ok: false, error: "base_url, api_key, and model are required" })
      }
      try {
        const testProvider = new OpenAIProvider(api_key, base_url)
        const response = await testProvider.chat({
          model,
          messages: [
            { id: "test_1", role: "user" as const, content: [{ type: "text" as const, text: "Say 'pong' and nothing else." }] },
          ],
        })
        const text = response.message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("")
        return reply.send({ ok: true, response: text.trim() })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    app.delete("/providers/:label", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const { label } = request.params as { label: string }
      const removed = await userStore.removeProvider(token, label)
      if (!removed) return reply.status(404).send({ error: `Provider '${label}' not found` })
      return reply.send({ removed: true, label })
    })

    app.get("/providers/:label/test", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      const provider = account.providers.find((p) => p.label === (request.params as { label: string }).label)
      if (!provider) return reply.status(404).send({ error: "Provider not found" })
      const modelsUrl = provider.baseUrl.endsWith("/v1")
        ? `${provider.baseUrl}/models`
        : `${provider.baseUrl.replace(/\/+$/, "")}/v1/models`
      try {
        const res = await fetch(modelsUrl, {
          headers: { Authorization: `Bearer ${provider.apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return reply.send({ ok: false, error: `Provider returned ${res.status}: ${text.slice(0, 200)}` })
        }
        const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (data.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by || "unknown" }))
        return reply.send({ ok: true, models })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    // ── Profile CRUD ──

    app.post("/v1/profiles", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      const body = request.body as Record<string, unknown>
      if (!body.name) return reply.status(400).send({ error: "name is required" })
      if (!(body.execution as Record<string, unknown>)?.provider)
        return reply.status(400).send({ error: "execution.provider is required" })

      const profile = await userStore.createProfile(token, {
        name: body.name as string,
        execution: body.execution as any,
        summarization: (body.summarization as any) || body.execution,
        embedding: (body.embedding as any) || body.execution,
        compression: (body.compression as ProfileCompression) || {
          trigger: "token_count",
          threshold: 80000,
          rate: "medium" as const,
        },
        retention: (body.retention as any) || DEFAULT_RETENTION_POLICY,
        contextWindow: (body.contextWindow as number) || 128000,
        tools: (body.tools as string[]) || [],
        modelPreferences: (body.modelPreferences as string[]) || [],
      })
      return reply.status(201).send(profile)
    })

    app.get("/v1/profiles", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      return reply.send({ profiles: account.profiles || [] })
    })

    app.get("/v1/profiles/:profileId", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const profile = await userStore.getProfile(token, (request.params as { profileId: string }).profileId)
      if (!profile) return reply.status(404).send({ error: "Profile not found" })
      return reply.send(profile)
    })

    app.put("/v1/profiles/:profileId", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const profile = await userStore.updateProfile(token, (request.params as { profileId: string }).profileId, request.body)
      if (!profile) return reply.status(404).send({ error: "Profile not found" })
      return reply.send(profile)
    })

    app.delete("/v1/profiles/:profileId", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const removed = await userStore.deleteProfile(token, (request.params as { profileId: string }).profileId)
      if (!removed) return reply.status(404).send({ error: "Profile not found" })
      return reply.send({ removed: true })
    })

    app.post("/v1/profiles/:profileId/regenerate-token", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const newToken = await userStore.regenerateProfileToken(token, (request.params as { profileId: string }).profileId)
      if (!newToken) return reply.status(404).send({ error: "Profile not found" })
      return reply.send({ authToken: newToken })
    })

    // ── Profile-scoped endpoints ──

    const resolveAccountAndProfile = async (token: string, profileId: string) => {
      const us = userStore
      let account = await us.getAccountByProfileToken(token)
      if (!account) account = await us.getAccount(token)
      if (!account) return { error: { status: 401, body: { error: "Invalid token" } } as const }
      const profile = (account.profiles || []).find((p) => p.id === profileId)
      if (!profile) return { error: { status: 404, body: { error: "Profile not found" } } as const }
      return { account, profile }
    }

    app.post("/v1/:profileId/chat/completions", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const resolved = await resolveAccountAndProfile(token, (request.params as { profileId: string }).profileId)
      if ("error" in resolved) return reply.status(resolved.error.status).send(resolved.error.body)
      const { account, profile } = resolved

      let providers
      try {
        providers = createProfileProviders(profile, account)
      } catch (e: any) {
        return reply.status(400).send({ error: e.message })
      }

      const chatBody = { ...request.body, model: providers.chatModel }

      // Apply profile compression settings to the conversation
      // This bridges ProfileCompression → MemoryPolicy before the chat handler runs
      return handleChatRequest(
        chatBody, reply, store, providers.chat, engine, vectorStore,
        providers.embeddings, request, token, profile.execution.provider,
        usageStore, metricsCollector,
        providers.summarization, providers.summarizationModel,
        userStore, profile.compression,
      )
    })

    app.get("/v1/:profileId/models", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const resolved = await resolveAccountAndProfile(token, (request.params as { profileId: string }).profileId)
      if ("error" in resolved) return reply.status(resolved.error.status).send(resolved.error.body)
      const { account, profile } = resolved
      const seen = new Set<string>()
      const models: Array<{ id: string; owned_by: string }> = []
      for (const role of [profile.execution, profile.summarization, profile.embedding]) {
        const p = account.providers.find((prov) => prov.label === role.provider)
        if (!p) continue
        const key = `${p.label}/${role.model}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({ id: key, owned_by: p.providerType })
        }
      }
      return reply.send({ object: "list", data: models })
    })

    // ── UI ──
    app.get("/ui", async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(DASHBOARD_HTML)
    })
    app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(DASHBOARD_HTML)
    })
    app.get("/add-provider", async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(WEB_UI_HTML)
    })
    app.get("/add-profile", async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(ADD_PROFILE_HTML)
    })

    // ── Account-scoped chat ──
    app.post("/v1/chat/completions", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const modelName = (request.body as Record<string, unknown>).model as string
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
      return handleChatRequest(
        chatBody, reply, store, providers.chat, engine, vectorStore,
        providers.embeddings, request, token, providerConfig.label,
        usageStore, metricsCollector, undefined, undefined, userStore, undefined,
      )
    })
    return
  }

  // Fallback routes (no user store)
  app.get("/v1/models", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      object: "list",
      data: [
        { id: "gpt-4o", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "system" },
        { id: "gpt-4o-mini", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "system" },
      ],
    })
  })
  app.post("/v1/chat/completions", async (request: FastifyRequest, reply: FastifyReply) => {
    const defaults = createFallbackProviders()
    const token = extractAuthToken(request)
    return handleChatRequest(
      request.body, reply, store, defaults.chat, engine, vectorStore,
      defaults.embeddings, request, token || undefined, "default",
      usageStore, metricsCollector, undefined, undefined, userStore, undefined,
    )
  })
}

// ── Chat request handler ──

async function handleChatRequest(
  body: any,
  reply: FastifyReply,
  store: IMemoryStore,
  provider: Provider,
  engine: ContextEngine,
  vectorStore: IVectorStore,
  embeddingsProvider: EmbeddingsProvider | undefined,
  request: FastifyRequest,
  userId: string | undefined,
  providerLabel: string | undefined,
  usageStore: IUsageStore | undefined,
  metricsCollector: MetricsCollector | undefined,
  summarizationProvider: Provider | undefined,
  summarizationModel: string | undefined,
  userStore: IUserStore | undefined,
  profileCompression?: ProfileCompression,
): Promise<void> {
  const req = request
  const convId = body.messages?.[0]?.conversation_id || `conv_${Date.now()}`
  const stream = body.stream ?? false
  const model = body.model
  const conv = await store.getOrCreateConversation(convId)
  const incomingMessages = toInternalMessages(body.messages)

  // Bridge profile compression settings to the conversation's MemoryPolicy
  // This enables per-profile adaptive compression policies
  if (profileCompression) {
    applyProfileCompressionToConversation(conv, profileCompression)
  }

  const budget = createBudget(body.max_tokens ? body.max_tokens * 4 : undefined)
  const assembled = engine.assemble(conv, incomingMessages, budget)
  const combinedMessages = [...assembled.systemMessages, ...assembled.workingMessages]

  const toolsWithHidden = [
    ...(body.tools || []),
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
    return handleStreaming(
      req, reply, conv, combinedMessages, toolsWithHidden, body,
      provider, store, engine, vectorStore, userId, model,
      providerLabel, usageStore, metricsCollector, userStore,
    )
  } else {
    return handleNonStreaming(
      reply, conv, combinedMessages, toolsWithHidden, body,
      provider, store, engine, vectorStore, userId, model,
      providerLabel, usageStore, metricsCollector, userStore,
    )
  }
}

// ── Streaming handler ──

async function handleStreaming(
  request: FastifyRequest,
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: any,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore: IVectorStore | undefined,
  userId: string | undefined,
  model: string | undefined,
  providerLabel: string | undefined,
  usageStore: IUsageStore | undefined,
  metricsCollector: MetricsCollector | undefined,
  userStore: IUserStore | undefined,
): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const startTime = Date.now()
  const pricing = new PricingEngine()
  const resolvedModel = model || body.model
  const MAX_PASSES = 3
  let currentMessages = messages
  let finalContent = ""
  let finalUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passEvents: any[] = []
      let passContent = ""
      let passUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null
      let hasToolCalls = false

      try {
        for await (const event of provider.chatStream({
          model: body.model,
          messages: currentMessages,
          tools,
          stream: true,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        })) {
          passEvents.push(event)
          if (event.type === "usage") {
            passUsage = event.data
          } else if (event.type === "chunk" && typeof event.data === "string") {
            passContent += event.data
          } else if (event.type === "tool_call") {
            hasToolCalls = true
          }
        }
      } catch (err) {
        console.error(`Stream pass ${pass + 1} error:`, err)
        finalContent = passContent
        finalUsage = passUsage
        break
      }

      // Record usage
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
          cost: pricing.computeCost(resolvedModel, passUsage.prompt_tokens, passUsage.completion_tokens),
          createdAt: Date.now(),
        })
      }

      if (!hasToolCalls) {
        finalContent = passContent
        finalUsage = passUsage
        break
      }

      // Execute hidden tools
      let needsReinference = false
      const toolCallEvents = passEvents.filter((e: any) => e.type === "tool_call")
      for (const tcEvent of toolCallEvents) {
        const tcs = Array.isArray(tcEvent.data) ? tcEvent.data : [tcEvent.data]
        for (const tc of tcs) {
          const name = tc.function?.name
          if (!name) continue
          const args = JSON.parse(tc.function?.arguments || "{}")
          const result = await executeHiddenTool(
            conv, name, args, store, engine, vectorStore,
            userStore, userId,
          )
          if (result) {
            recordToolCall(conv, name, args, result.resultText || "")
            if (result.appendMessages.length > 0) {
              currentMessages = [...currentMessages, ...result.appendMessages]
              needsReinference = true
            }
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

    // Stream the stabilized content
    if (finalContent) {
      reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, finalContent))
    }
    reply.raw.write(serializeStreamDone())
  } catch (err) {
    console.error("Stream error:", err)
    reply.raw.write(serializeStreamDone())
  }
  reply.raw.end()

  const latency = Date.now() - startTime
  metricsCollector?.recordLatency(latency)

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

// ── Non-streaming handler ──

async function handleNonStreaming(
  reply: FastifyReply,
  conv: Conversation,
  messages: Message[],
  tools: unknown[],
  body: any,
  provider: Provider,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore: IVectorStore | undefined,
  userId: string | undefined,
  modelName: string | undefined,
  providerLabel: string | undefined,
  usageStore: IUsageStore | undefined,
  metricsCollector: MetricsCollector | undefined,
  userStore: IUserStore | undefined,
): Promise<void> {
  const maxReinferences = 3
  let reinferenceCount = 0
  let currentMessages = messages
  let finalContent = ""
  const startTime = Date.now()
  const pricing = new PricingEngine()
  const model = modelName || body.model

  while (reinferenceCount < maxReinferences) {
    const response = await provider.chat({
      model: body.model,
      messages: currentMessages,
      tools,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
    })

    if (usageStore && userId) {
      usageStore.record({
        id: randomUUID(),
        userId,
        conversationId: conv.id,
        model,
        providerLabel: providerLabel || "default",
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        cost: pricing.computeCost(model, response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0),
        createdAt: Date.now(),
      })
    }

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
      const result = await executeHiddenTool(
        conv, name, args, store, engine, vectorStore,
        userStore, userId,
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

// ── Hidden tool execution ──

async function executeHiddenTool(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore: IVectorStore | undefined,
  userStore: IUserStore | undefined,
  userId: string | undefined,
): Promise<{ needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null> {
  let result: { needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null = null

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
      const r = await executeCompressMemory(conv, args.scope_id as string, args.level as CompressionLevel)
      result = { needsReinference: false, appendMessages: [], resultText: r.message }
      break
    }

    case "expand_memory_range": {
      const r = executeExpandMemoryRange(conv, args.start_span as string, args.end_span as string)
      if (r.messages.length > 0) {
        result = { needsReinference: true, appendMessages: r.messages }
      } else {
        result = { needsReinference: false, appendMessages: [], resultText: "No spans expanded" }
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
        compressionStrategy: args.compression_strategy as CompressionStrategy,
        compressionRate: args.compression_rate as CompressionRate,
        recencyBias: args.recency_bias as number,
        retentionPriority: args.retention_priority as string[],
        tokenThreshold: args.token_threshold as number,
        messageThreshold: args.message_threshold as number,
        idleThresholdMs: args.idle_threshold_ms as number,
        semanticDistanceThreshold: args.semantic_distance_threshold as number,
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

// ── HTML templates (moved from compiled JS to keep the source in one place) ──

const WEB_UI_HTML = `<!DOCTYPE html>
<html lang="en" x-data="app()">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Add Provider</title>
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
  .wizard-steps { display: flex; gap: 8px; margin-bottom: 24px; }
  .wizard-steps .step { flex: 1; text-align: center; padding: 8px; border-radius: 6px; background: #161b22; border: 1px solid #30363d; font-size: 0.8rem; color: #8b949e; }
  .wizard-steps .step.active { border-color: #58a6ff; color: #58a6ff; }
  .wizard-steps .step.done { border-color: #238636; color: #3fb950; }
  .type-grid { display: grid; gap: 12px; margin-bottom: 12px; }
  .type-option { padding: 16px; border-radius: 6px; border: 1px solid #30363d; cursor: pointer; background: #0d1117; }
  .type-option:hover { border-color: #58a6ff; }
  .type-option.selected { border-color: #238636; background: #1c3a1c; }
  .type-name { font-weight: 600; color: #f0f6fc; margin-bottom: 4px; }
  .type-desc { font-size: 0.8rem; color: #8b949e; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  .model-list { max-height: 300px; overflow-y: auto; border: 1px solid #30363d; border-radius: 6px; padding: 8px; margin-bottom: 12px; }
  .model-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #21262d; cursor: pointer; }
  .model-row input { width: auto; margin-bottom: 0; }
  .chat-box { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  .chat-bubble { display: inline-block; padding: 8px 12px; border-radius: 6px; }
  .chat-bubble.user { background: #161b22; }
  .chat-bubble.assistant { background: #1c3a1c; color: #7ee787; }
  .summary-row { margin-bottom: 8px; font-size: 0.85rem; }
</style>
</head>
<body>

<h1>engramic</h1>
<p class="subtitle">Add Provider</p>

<div class="wizard-steps">
  <div class="step" :class="{ active: step === 1, done: step > 1 }">1. Type</div>
  <div class="step" :class="{ active: step === 2, done: step > 2 }">2. Connect</div>
  <div class="step" :class="{ active: step === 3, done: step > 3 }">3. Models</div>
  <div class="step" :class="{ active: step === 4, done: step > 4 }">4. Validate</div>
  <div class="step" :class="{ active: step === 5, done: step > 5 }">5. Save</div>
</div>

<!-- Step 1: Select Type -->
<div class="card" x-show="step === 1">
  <h2>Select Provider Type</h2>
  <div class="type-grid">
    <div class="type-option" :class="{ selected: form.providerType === 'openai' }" @click="form.providerType = 'openai'">
      <div class="type-name">OpenAI Compatible</div>
      <div class="type-desc">Any provider using the OpenAI API format (OpenAI, DeepSeek, local proxies, etc.)</div>
    </div>
    <div class="type-option" :class="{ selected: form.providerType === 'anthropic' }" @click="form.providerType = 'anthropic'">
      <div class="type-name">Anthropic</div>
      <div class="type-desc">Claude API via Anthropic or an OpenAI-compatible proxy</div>
    </div>
  </div>
  <div class="actions">
    <button class="btn btn-primary" @click="nextStep()">Next</button>
  </div>
</div>

<!-- Step 2: Connection -->
<div class="card" x-show="step === 2">
  <h2>Connection</h2>
  <label>Base URL</label>
  <input x-model="form.baseUrl" placeholder="https://api.openai.com/v1">
  <label>API Key</label>
  <input x-model="form.apiKey" type="password" placeholder="sk-...">
  <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
    <button class="btn btn-primary" @click="testConnection()" x-text="testing ? 'Testing...' : 'Test Connection'" :disabled="testing || !form.baseUrl || !form.apiKey"></button>
    <span x-show="tested" style="color:#3fb950; font-size:0.85rem;">&#10003; Connected</span>
    <span x-show="testError" style="color:#f85149; font-size:0.85rem;" x-text="testError"></span>
  </div>
  <div class="actions">
    <button class="btn" @click="prevStep()">Back</button>
    <button class="btn btn-primary" @click="nextStep()" :disabled="!tested">Next</button>
  </div>
</div>

<!-- Step 3: Select Models -->
<div class="card" x-show="step === 3">
  <h2>Select Models</h2>
  <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:12px;">
    <input type="checkbox" x-model="form.useWildcard" style="width:auto; margin-bottom:0;">
    <span>Allow any model (wildcard)</span>
  </label>
  <div x-show="!form.useWildcard" class="model-list">
    <template x-for="m in allModels" :key="m.id">
      <div class="model-row" @click="toggleModel(m.id)">
        <input type="checkbox" :checked="form.selectedModels.includes(m.id)" @click.stop style="width:auto; margin-bottom:0;">
        <span x-text="m.id"></span>
        <span class="badge" x-text="m.owned_by"></span>
      </div>
    </template>
    <p x-show="allModels.length === 0" class="empty">No models found</p>
  </div>
  <div class="actions">
    <button class="btn" @click="prevStep()">Back</button>
    <button class="btn btn-primary" @click="nextStep()" :disabled="!canProceedFromModels()">Next</button>
  </div>
</div>

<!-- Step 4: Validate Chat -->
<div class="card" x-show="step === 4">
  <h2>Validate Chat Endpoint</h2>
  <p style="color:#8b949e; font-size:0.85rem; margin-bottom:12px;">Send a test message to verify the completions endpoint works.</p>
  <div class="chat-box">
    <div style="color:#8b949e; font-size:0.8rem; margin-bottom:4px;">User</div>
    <div class="chat-bubble user">Say 'pong' and nothing else.</div>
  </div>
  <div x-show="chatTest.result" class="chat-box">
    <div style="color:#8b949e; font-size:0.8rem; margin-bottom:4px;">Assistant</div>
    <div class="chat-bubble assistant" x-text="chatTest.result"></div>
  </div>
  <div x-show="chatTest.error" style="color:#f85149; font-size:0.85rem; margin-bottom:12px;" x-text="chatTest.error"></div>
  <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
    <button class="btn btn-primary" @click="testChat()" x-text="chatTest.loading ? 'Testing...' : 'Send Test'" :disabled="chatTest.loading"></button>
    <span x-show="chatTest.validated" style="color:#3fb950; font-size:0.85rem;">&#10003; Chat works</span>
  </div>
  <div class="actions">
    <button class="btn" @click="prevStep()">Back</button>
    <button class="btn btn-primary" @click="nextStep()" :disabled="!chatTest.validated">Next</button>
  </div>
</div>

<!-- Step 5: Save -->
<div class="card" x-show="step === 5">
  <h2>Save Provider</h2>
  <div class="card" style="background:#0d1117; margin-bottom:16px;">
    <div class="summary-row"><strong>Type:</strong> <span x-text="form.providerType"></span></div>
    <div class="summary-row"><strong>URL:</strong> <span x-text="form.baseUrl"></span></div>
    <div class="summary-row"><strong>Models:</strong> <span x-text="modelSummary()"></span></div>
  </div>
  <label>Provider Label / ID</label>
  <input x-model="form.label" placeholder="e.g. openai, deepseek, local-llm">
  <div class="actions">
    <button class="btn" @click="prevStep()">Back</button>
    <button class="btn btn-primary" @click="saveProvider()" x-text="saving ? 'Saving...' : 'Save Provider'" :disabled="saving || !form.label"></button>
  </div>
</div>

<!-- Existing Providers -->
<div class="card" x-show="step === 1">
  <h2>Existing Providers</h2>
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
          <td><button class="btn btn-danger" @click="removeProvider(p.label)">Remove</button></td>
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
  @click="toast.show = false"
></div>

<style>
  .toast.ok { background: #238636; }
  .toast.err { background: #da3633; }
</style>

<script>
document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    step: 1,
    providers: [],
    loaded: false,
    saving: false,
    testing: false,
    tested: false,
    testError: "",
    allModels: [],
    chatTest: { loading: false, result: "", error: "", validated: false },
    toast: { show: false, message: "", type: "ok" },
    form: {
      providerType: "openai",
      baseUrl: "",
      apiKey: "",
      useWildcard: false,
      selectedModels: [],
      label: "",
    },
    async init() {
      const token = localStorage.getItem("engramic_token")
      if (token) await this.loadProviders()
      else this.loaded = true
    },
    async api(path, opts = {}) {
      const headers = { "Content-Type": "application/json" }
      const token = localStorage.getItem("engramic_token")
      if (token) headers["Authorization"] = "Bearer " + token
      const res = await fetch(window.location.origin + path, { headers, ...opts })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || res.statusText) }
      if (!res.ok) throw new Error(data.error || res.statusText)
      return data
    },
    notify(msg, type = "ok") {
      this.toast = { show: true, message: msg, type }
      setTimeout(() => { if (this.toast.message === msg) this.toast.show = false }, 3000)
    },
    nextStep() { if (this.step < 5) this.step++ },
    prevStep() { if (this.step > 1) this.step-- },
    async testConnection() {
      this.testing = true
      this.testError = ""
      this.tested = false
      this.allModels = []
      try {
        const data = await this.api("/test-provider", {
          method: "POST",
          body: JSON.stringify({ base_url: this.form.baseUrl, api_key: this.form.apiKey }),
        })
        if (!data.ok) { this.testError = data.error || "Connection failed"; return }
        this.allModels = data.models || []
        this.tested = true
        if (this.allModels.length > 0) this.form.selectedModels = [this.allModels[0].id]
      } catch (e) { this.testError = e.message }
      finally { this.testing = false }
    },
    toggleModel(id) {
      const idx = this.form.selectedModels.indexOf(id)
      if (idx >= 0) this.form.selectedModels.splice(idx, 1)
      else this.form.selectedModels.push(id)
    },
    canProceedFromModels() { return this.form.useWildcard || this.form.selectedModels.length > 0 },
    async testChat() {
      this.chatTest.loading = true
      this.chatTest.error = ""
      this.chatTest.result = ""
      this.chatTest.validated = false
      const model = this.form.useWildcard ? (this.allModels[0]?.id || "") : (this.form.selectedModels[0] || "")
      if (!model) { this.chatTest.error = "No model selected"; this.chatTest.loading = false; return }
      try {
        const data = await this.api("/test-chat", {
          method: "POST",
          body: JSON.stringify({ base_url: this.form.baseUrl, api_key: this.form.apiKey, provider: this.form.providerType, model }),
        })
        if (!data.ok) { this.chatTest.error = data.error || "Chat test failed"; return }
        this.chatTest.result = data.response
        this.chatTest.validated = true
      } catch (e) { this.chatTest.error = e.message }
      finally { this.chatTest.loading = false }
    },
    modelSummary() { return this.form.useWildcard ? "Any" : this.form.selectedModels.join(", ") },
    async loadProviders() {
      try { const d = await this.api("/providers"); this.providers = d.providers || [] }
      catch (e) { this.notify(e.message, "err") }
      this.loaded = true
    },
    async saveProvider() {
      const f = this.form
      if (!f.label || !f.apiKey) { this.notify("Label and API key are required", "err"); return }
      this.saving = true
      try {
        const defaultModel = f.useWildcard ? "*" : (f.selectedModels[0] || "")
        const data = await this.api("/register", {
          method: "POST",
          body: JSON.stringify({
            label: f.label, api_key: f.apiKey, base_url: f.baseUrl,
            default_model: defaultModel, provider: f.providerType,
          }),
        })
        if (data.token) localStorage.setItem("engramic_token", data.token)
        this.notify("Provider saved")
        f.apiKey = ""; f.baseUrl = ""; f.selectedModels = []; f.useWildcard = false; f.label = ""
        this.step = 1; this.tested = false
        this.chatTest = { loading: false, result: "", error: "", validated: false }
        await this.loadProviders()
      } catch (e) { this.notify(e.message, "err") }
      finally { this.saving = false }
    },
    async removeProvider(label) {
      if (!confirm('Remove provider "' + label + '"?')) return
      try { await this.api("/providers/" + encodeURIComponent(label), { method: "DELETE" }); this.notify("Provider removed"); await this.loadProviders() }
      catch (e) { this.notify(e.message, "err") }
    },
  }))
})
</script>
</body>
</html>`

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en" x-data="dashboard()">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Dashboard</title>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; color: #f0f6fc; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .card h2 { font-size: 1rem; color: #f0f6fc; }
  .btn { padding: 6px 14px; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-danger { background: #da3633; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  .btn-add { font-size: 1.25rem; line-height: 1; padding: 4px 10px; }
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
<p class="subtitle">Dashboard</p>

<div class="card">
  <div class="card-header">
    <h2>Providers</h2>
    <a href="/add-provider" class="btn btn-primary btn-add">+</a>
  </div>
  <template x-if="!loaded">
    <p class="empty">Loading...</p>
  </template>
  <template x-if="loaded && providers.length === 0">
    <p class="empty">No providers configured. <a href="/add-provider" style="color:#58a6ff;">Add one</a></p>
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
          <td><button class="btn btn-danger" @click="removeProvider(p.label)">Remove</button></td>
        </tr>
      </template>
    </tbody>
  </table>
</div>

<div class="card">
  <div class="card-header">
    <h2>Profiles</h2>
    <a href="/add-profile" class="btn btn-primary btn-add">+</a>
  </div>
  <template x-if="!profilesLoaded">
    <p class="empty">Loading...</p>
  </template>
  <template x-if="profilesLoaded && profiles.length === 0">
    <p class="empty">No profiles created. <a href="/add-profile" style="color:#58a6ff;">Add one</a></p>
  </template>
  <table x-show="profilesLoaded && profiles.length > 0">
    <thead><tr><th>Name</th><th>Execution</th><th>Summarization</th><th>Embedding</th><th>Context</th><th></th></tr></thead>
    <tbody>
      <template x-for="p in profiles" :key="p.id">
        <tr>
          <td class="provider-label" x-text="p.name"></td>
          <td><span class="badge" x-text="p.execution.provider + '/' + p.execution.model"></span></td>
          <td><span class="badge" x-text="p.summarization.provider + '/' + p.summarization.model"></span></td>
          <td><span class="badge" x-text="p.embedding.provider + '/' + p.embedding.model"></span></td>
          <td x-text="p.contextWindow"></td>
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
  @click="toast.show = false"
></div>

<style>
  .toast.ok { background: #238636; }
  .toast.err { background: #da3633; }
</style>

<script>
document.addEventListener("alpine:init", () => {
  Alpine.data("dashboard", () => ({
    providers: [],
    profiles: [],
    loaded: false,
    profilesLoaded: false,
    toast: { show: false, message: "", type: "ok" },
    async init() { await this.loadProviders(); await this.loadProfiles() },
    async api(path, opts = {}) {
      const headers = { "Content-Type": "application/json" }
      const token = localStorage.getItem("engramic_token")
      if (token) headers["Authorization"] = "Bearer " + token
      const res = await fetch(window.location.origin + path, { headers, ...opts })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || res.statusText) }
      if (!res.ok) throw new Error(data.error || res.statusText)
      return data
    },
    notify(msg, type = "ok") { this.toast = { show: true, message: msg, type }; setTimeout(() => { if (this.toast.message === msg) this.toast.show = false }, 3000) },
    async loadProviders() { try { const d = await this.api("/providers"); this.providers = d.providers || [] } catch (e) { this.notify(e.message, "err") }; this.loaded = true },
    async loadProfiles() { try { const d = await this.api("/v1/profiles"); this.profiles = d.profiles || [] } catch (e) { console.error("Failed to load profiles:", e) }; this.profilesLoaded = true },
    async removeProvider(label) {
      if (!confirm('Remove provider "' + label + '"?')) return
      try { await this.api("/providers/" + encodeURIComponent(label), { method: "DELETE" }); this.notify("Provider removed"); await this.loadProviders() }
      catch (e) { this.notify(e.message, "err") }
    },
  }))
})
</script>
</body>
</html>`

const ADD_PROFILE_HTML = `<!DOCTYPE html>
<html lang="en" x-data="profileApp()">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Add Profile</title>
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
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; background: #1f6feb22; color: #58a6ff; }
</style>
</head>
<body>

<h1>engramic</h1>
<p class="subtitle">Add Profile</p>

<div class="card">
  <h2>New Profile</h2>
  <label>Name</label>
  <input x-model="form.name" placeholder="e.g. Default, Fast, Creative">

  <label>Execution Provider</label>
  <select x-model="form.executionProvider">
    <template x-for="p in providers" :key="p.label">
      <option x-text="p.label" :value="p.label"></option>
    </template>
  </select>

  <label>Execution Model</label>
  <input x-model="form.executionModel" placeholder="gpt-4o or * for wildcard">

  <label>Context Window</label>
  <input x-model.number="form.contextWindow" type="number" placeholder="128000">

  <div class="actions">
    <a href="/" class="btn" style="background:#21262d; color:#c9d1d9; text-decoration:none;">Cancel</a>
    <button class="btn btn-primary" @click="saveProfile()" x-text="saving ? 'Saving...' : 'Save Profile'" :disabled="saving || !form.name || !form.executionProvider"></button>
  </div>
</div>

<div
  x-show="toast.show"
  x-text="toast.message"
  :class="'toast ' + toast.type"
  style="position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; color: #fff; font-size: 0.85rem; cursor: pointer"
  @click="toast.show = false"
></div>

<style>
  .toast.ok { background: #238636; }
  .toast.err { background: #da3633; }
</style>

<script>
document.addEventListener("alpine:init", () => {
  Alpine.data("profileApp", () => ({
    providers: [],
    saving: false,
    toast: { show: false, message: "", type: "ok" },
    form: { name: "", executionProvider: "", executionModel: "*", contextWindow: 128000 },
    async init() { await this.loadProviders() },
    async api(path, opts = {}) {
      const headers = { "Content-Type": "application/json" }
      const token = localStorage.getItem("engramic_token")
      if (token) headers["Authorization"] = "Bearer " + token
      const res = await fetch(window.location.origin + path, { headers, ...opts })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || res.statusText) }
      if (!res.ok) throw new Error(data.error || res.statusText)
      return data
    },
    notify(msg, type = "ok") { this.toast = { show: true, message: msg, type }; setTimeout(() => { if (this.toast.message === msg) this.toast.show = false }, 3000) },
    async loadProviders() {
      try { const d = await this.api("/providers"); this.providers = d.providers || []; if (this.providers.length > 0) this.form.executionProvider = this.providers[0].label }
      catch (e) { console.error("Failed to load providers:", e) }
    },
    async saveProfile() {
      this.saving = true
      try {
        await this.api("/v1/profiles", { method: "POST", body: JSON.stringify({ name: this.form.name, execution: { provider: this.form.executionProvider, model: this.form.executionModel }, contextWindow: this.form.contextWindow }) })
        this.notify("Profile created"); window.location.href = "/"
      } catch (e) { this.notify(e.message, "err") }
      finally { this.saving = false }
    },
  }))
})
</script>
</body>
</html>`

const CHATS_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Conversations</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
  h1 { font-size: 1.5rem; margin-bottom: 16px; }
  .conv-list { display: flex; flex-direction: column; gap: 8px; }
  .conv-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; cursor: pointer; }
  .conv-card:hover { border-color: #58a6ff; }
  .conv-id { font-weight: 600; font-size: 0.9rem; color: #f0f6fc; }
  .conv-preview { font-size: 0.82rem; color: #8b949e; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .conv-meta { font-size: 0.75rem; color: #484f58; margin-top: 4px; display: flex; gap: 12px; }
</style>
</head>
<body>
<h1>Conversations</h1>
<div id="list" class="conv-list"></div>
<script>
async function load() {
  const token = localStorage.getItem("engramic_token")
  const headers = {}
  if (token) headers["Authorization"] = "Bearer " + token
  const res = await fetch("/api/conversations", { headers })
  const data = await res.json()
  const list = document.getElementById("list")
  list.innerHTML = ""
  for (const c of data.conversations) {
    const card = document.createElement("div")
    card.className = "conv-card"
    card.innerHTML = '<div class="conv-id">' + c.id + '</div><div class="conv-preview">' + (c.preview || "(empty)") + '</div><div class="conv-meta"><span>' + c.spanCount + ' spans</span><span>' + c.messageCount + ' messages</span><span>' + new Date(c.updatedAt).toLocaleString() + '</span></div>'
    card.onclick = () => window.location = "/api/conversations/" + c.id
    list.appendChild(card)
  }
}
load()
</script>
</body>
</html>`
