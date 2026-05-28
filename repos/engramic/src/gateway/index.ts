import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import type { Conversation, Message, ChatCompletionRequest, TokenBudget, SummaryNode, RegisterRequest, RegisterResponse, AddProviderResponse, ProviderConfig, UsageRecord, ToolCallRecord, SystemEvent, ModelAssignment, ProfileCompression, Profile } from "../types.js"
import type { IMemoryStore } from "../memory/store.js"
import type { IVectorStore } from "../memory/vector.js"
import type { IUserStore } from "../auth/user-store.js"
import type { IUsageStore } from "../usage/store.js"
import { PricingEngine } from "../usage/pricing.js"
import { MetricsCollector } from "../usage/metrics.js"
import { randomUUID } from "node:crypto"
import { Provider } from "../provider/index.js"
import { OpenAIProvider } from "../provider/openai.js"
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

function recordToolCall(conv: Conversation, name: string, args: Record<string, unknown>, result: string): void {
  conv.toolCalls.push({ name, arguments: args, result, timestamp: Date.now() })
}

function recordSystemEvent(conv: Conversation, type: SystemEvent["type"], description: string, details?: Record<string, unknown>): void {
  conv.systemEvents.push({ type, description, details, timestamp: Date.now() })
}

export function registerRoutes(
  app: FastifyInstance,
  store: IMemoryStore,
  globalProvider: Provider,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
  embeddingsProvider?: EmbeddingsProvider,
  userStore?: IUserStore,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
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

  app.get("/api/conversations", async (_request, reply) => {
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

  app.get("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string }
    const conv = await store.getOrCreateConversation(id)
    const timeline: Array<Record<string, unknown>> = []

    for (let si = 0; si < conv.spans.length; si++) {
      const span = conv.spans[si]
      for (const msg of span.messages) {
        if (msg.role === "user") {
          timeline.push({ type: "user", role: "user", content: extractText(msg), spanIndex: si, timestamp: span.createdAt })
        } else if (msg.role === "assistant") {
          timeline.push({ type: "assistant", role: "assistant", content: extractText(msg), spanIndex: si, timestamp: span.createdAt })
        } else if (msg.role === "system") {
          timeline.push({ type: "system", role: "system", content: extractText(msg), spanIndex: si, timestamp: span.createdAt })
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

  app.get("/chats", async (_request, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8")
    return reply.send(CHATS_UI_HTML)
  })

  if (usageStore) {
    app.get("/v1/usage", async (request, reply) => {
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

    app.get("/v1/usage/records", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const sinceQuery = (request.query as Record<string, string>).since
      const since = sinceQuery ? parseInt(sinceQuery, 10) : undefined
      const records = await usageStore.getByUser(token, since)
      return reply.send({ records })
    })
  }

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

    app.post<{ Body: { base_url: string; api_key: string } }>("/test-provider", async (request, reply) => {
      const { base_url, api_key } = request.body
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
        const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (data.data || []).map((m: { id: string; owned_by?: string }) => ({ id: m.id, owned_by: m.owned_by || "unknown" }))
        return reply.send({ ok: true, models })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    app.post<{ Body: { base_url: string; api_key: string; provider: string; model: string } }>("/test-chat", async (request, reply) => {
      const { base_url, api_key, provider: providerType, model } = request.body
      if (!api_key || !base_url || !model) {
        return reply.status(400).send({ ok: false, error: "base_url, api_key, and model are required" })
      }
      try {
        const testProvider = new OpenAIProvider(api_key, base_url)
        const response = await testProvider.chat({
          model,
          messages: [
            { id: "test_1", role: "user", content: [{ type: "text", text: "Say 'pong' and nothing else." }] },
          ],
        })
        const text = response.message.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("")
        return reply.send({ ok: true, response: text.trim() })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    app.delete("/providers/:label", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization header required" })
      const { label } = request.params as { label: string }
      const removed = await userStore.removeProvider(token, label)
      if (!removed) return reply.status(404).send({ error: `Provider '${label}' not found` })
      return reply.send({ removed: true, label })
    })

    app.get<{ Params: { label: string } }>("/providers/:label/test", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      const provider = account.providers.find((p) => p.label === (request.params as any).label)
      if (!provider) return reply.status(404).send({ error: "Provider not found" })
      let modelsUrl = provider.baseUrl.endsWith("/v1") ? `${provider.baseUrl}/models` : `${provider.baseUrl.replace(/\/+$/, "")}/v1/models`
      try {
        const res = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(10000) })
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return reply.send({ ok: false, error: `Provider returned ${res.status}: ${text.slice(0, 200)}` })
        }
        const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> }
        const models = (data.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by || "unknown" }))
        return reply.send({ ok: true, models })
      } catch (e: any) {
        return reply.send({ ok: false, error: e.message })
      }
    })

    app.post<{ Body: { name: string; execution: ModelAssignment; summarization: ModelAssignment; embedding: ModelAssignment; compression: ProfileCompression; contextWindow: number; tools: string[]; modelPreferences: string[] } }>("/v1/profiles", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })

      const body = request.body
      if (!body.name) return reply.status(400).send({ error: "name is required" })
      if (!body.execution?.provider) return reply.status(400).send({ error: "execution.provider is required" })

      const profile = await userStore.createProfile(token, {
        name: body.name,
        execution: body.execution,
        summarization: body.summarization || body.execution,
        embedding: body.embedding || body.execution,
        compression: body.compression || { trigger: "token_count", threshold: 80000, rate: "medium" },
        contextWindow: body.contextWindow || 128000,
        tools: body.tools || [],
        modelPreferences: body.modelPreferences || [],
      })
      return reply.status(201).send(profile)
    })

    app.get("/v1/profiles", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const account = await userStore.getAccount(token)
      if (!account) return reply.status(401).send({ error: "Invalid token" })
      return reply.send({ profiles: account.profiles || [] })
    })

    app.get<{ Params: { profileId: string } }>("/v1/profiles/:profileId", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const profile = await userStore.getProfile(token, (request.params as any).profileId)
      if (!profile) return reply.status(404).send({ error: "Profile not found" })
      return reply.send(profile)
    })

    app.put<{ Params: { profileId: string }; Body: Partial<Profile> }>("/v1/profiles/:profileId", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const profile = await userStore.updateProfile(token, (request.params as any).profileId, request.body)
      if (!profile) return reply.status(404).send({ error: "Profile not found" })
      return reply.send(profile)
    })

    app.delete<{ Params: { profileId: string } }>("/v1/profiles/:profileId", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const removed = await userStore.deleteProfile(token, (request.params as any).profileId)
      if (!removed) return reply.status(404).send({ error: "Profile not found" })
      return reply.send({ removed: true })
    })

    app.post<{ Params: { profileId: string } }>("/v1/profiles/:profileId/regenerate-token", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const newToken = await userStore.regenerateProfileToken(token, (request.params as any).profileId)
      if (!newToken) return reply.status(404).send({ error: "Profile not found" })
      return reply.send({ authToken: newToken })
    })

    const resolveAccountAndProfile = async (token: string, profileId: string):
      Promise<{ account: NonNullable<Awaited<ReturnType<IUserStore["getAccount"]>>>, profile: Profile } | { error: { status: number; body: any } }> => {
      const us = userStore!
      let account = await us.getAccountByProfileToken(token)
      if (!account) account = await us.getAccount(token)
      if (!account) return { error: { status: 401, body: { error: "Invalid token" } } }
      const profile = (account.profiles || []).find((p) => p.id === profileId)
      if (!profile) return { error: { status: 404, body: { error: "Profile not found" } } }
      return { account, profile }
    }

    app.post<{ Params: { profileId: string }; Body: ChatCompletionRequest }>("/v1/:profileId/chat/completions", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const resolved = await resolveAccountAndProfile(token, (request.params as any).profileId)
      if ("error" in resolved) return reply.status(resolved.error.status).send(resolved.error.body)
      const { account, profile } = resolved

      const providerConfig = account.providers.find((p) => p.label === profile.execution.provider)
      if (!providerConfig) return reply.status(400).send({ error: `Provider '${profile.execution.provider}' not found in account` })

      let model = profile.execution.model
      if (model === "auto") {
        for (const pref of profile.modelPreferences) {
          if (providerConfig.defaultModel === pref || pref === "*") { model = providerConfig.defaultModel; break }
        }
        if (model === "auto") model = providerConfig.defaultModel
      }

      const chatBody = { ...request.body, model }
      const providers = createUserProviders(providerConfig)
      return handleChatRequest(chatBody, reply, store, providers.chat, engine, vectorStore, providers.embeddings, request)
    })

    app.get<{ Params: { profileId: string } }>("/v1/:profileId/models", async (request, reply) => {
      const token = extractAuthToken(request)
      if (!token) return reply.status(401).send({ error: "Authorization required" })
      const resolved = await resolveAccountAndProfile(token, (request.params as any).profileId)
      if ("error" in resolved) return reply.status(resolved.error.status).send(resolved.error.body)
      const { account, profile } = resolved

      const seen = new Set<string>()
      const models: Array<{ id: string; owned_by: string }> = []
      for (const role of [profile.execution, profile.summarization, profile.embedding]) {
        const p = account.providers.find((prov) => prov.label === role.provider)
        if (!p) continue
        const key = `${p.label}/${role.model}`
        if (!seen.has(key)) { seen.add(key); models.push({ id: key, owned_by: p.providerType }) }
      }
      return reply.send({ object: "list", data: models })
    })

    app.get("/ui", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(DASHBOARD_HTML)
    })

    app.get("/", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(DASHBOARD_HTML)
    })

    app.get("/add-provider", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(WEB_UI_HTML)
    })

    app.get("/add-profile", async (_request, reply) => {
      reply.header("Content-Type", "text/html; charset=utf-8")
      return reply.send(ADD_PROFILE_HTML)
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
      return handleChatRequest(chatBody, reply, store, providers.chat, engine, vectorStore, providers.embeddings, request, token, providerConfig.label, usageStore, metricsCollector)
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
    const token = extractAuthToken(request)
    return handleChatRequest(request.body, reply, store, defaults.chat, engine, vectorStore, defaults.embeddings, request, token || undefined, "default", usageStore, metricsCollector)
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
  userId?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
): Promise<void> {
  const req = request!
  const convId = (body.messages[0] as Record<string, unknown>)?.conversation_id as string || `conv_${Date.now()}`
  const stream = body.stream ?? false
  const model = body.model

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

  metricsCollector?.recordRequest()

  if (stream) {
    return handleStreaming(req, reply, conv, combinedMessages, toolsWithHidden, body, provider, store, engine, vectorStore, userId, model, providerLabel, usageStore, metricsCollector)
  } else {
    return handleNonStreaming(reply, conv, combinedMessages, toolsWithHidden, body, provider, store, engine, vectorStore, userId, model, providerLabel, usageStore, metricsCollector)
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
  userId?: string,
  model?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const buffer = createStreamBuffer()
  const fullContent: string[] = []
  const startTime = Date.now()
  let streamUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null

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

      if (event.type === "usage") {
        streamUsage = event.data as { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      } else if (event.type === "chunk" && typeof event.data === "string") {
        fullContent.push(event.data)
        reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
      } else if (event.type === "tool_call") {
        const toolCalls = Array.isArray(event.data) ? event.data : [event.data]
        for (const tc of toolCalls) {
          const name = tc.function?.name
          if (name) {
            await handleHiddenTool(conv, name, tc.function?.arguments || "{}", provider, messages, body, reply, fullContent, store, engine, vectorStore, userId, model, providerLabel, usageStore, metricsCollector)
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

  const latency = Date.now() - startTime
  metricsCollector?.recordLatency(latency)

  if (usageStore && userId && model) {
    const pricing = new PricingEngine()
    const usage: UsageRecord = {
      id: randomUUID(),
      userId,
      conversationId: conv.id,
      model,
      providerLabel: providerLabel || "default",
      promptTokens: streamUsage?.prompt_tokens ?? 0,
      completionTokens: streamUsage?.completion_tokens ?? 0,
      totalTokens: streamUsage?.total_tokens ?? 0,
      cost: pricing.computeCost(model, streamUsage?.prompt_tokens ?? 0, streamUsage?.completion_tokens ?? 0),
      createdAt: Date.now(),
    }
    usageStore.record(usage)
  }

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
  userId?: string,
  modelName?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
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
      const usage: UsageRecord = {
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
      }
      usageStore.record(usage)
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

async function executeHiddenTool(
  conv: Conversation,
  name: string,
  args: Record<string, unknown>,
  store: IMemoryStore,
  engine: ContextEngine,
  vectorStore?: IVectorStore,
): Promise<{ needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null> {
  let result: { needsReinference: boolean; appendMessages: Message[]; resultText?: string } | null = null

  switch (name) {
    case "remember": {
      const r = executeRemember(conv, args.memory_id as string)
      if (r.messages) {
        result = { needsReinference: true, appendMessages: r.messages }
      } else {
        result = { needsReinference: false, appendMessages: [], resultText: "Memory not found" }
      }
      break
    }

    case "search_memory": {
      const r = await executeSearch(conv, args.query as string, vectorStore)
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
      const r = executeCompressMemory(conv, args.scope_id as string, args.level as CompressionLevel)
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
          r = executeQueryMemoryGraph(conv, scored.map((s) => s.handle.topic).join(" "), (args.depth as number) || 1)
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
  userId?: string,
  modelName?: string,
  providerLabel?: string,
  usageStore?: IUsageStore,
  metricsCollector?: MetricsCollector,
): Promise<void> {
  const args = JSON.parse(argsStr)
  const model = modelName || body.model
  const pricing = new PricingEngine()

  if (name === "remember") {
    const result = executeRemember(conv, args.memory_id)
    const resultText = result.messages
      ? `Remembered memory ${args.memory_id}, rehydrated ${result.messages.length} messages`
      : "Memory not found"
    recordToolCall(conv, name, args, resultText)
    if (result.messages) {
      const reinferenceMessages = [...messages, ...result.messages]
      try {
        const stream = provider.chatStream({
          model: body.model,
          messages: reinferenceMessages,
          stream: true,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        })
        for await (const event of stream) {
          if (event.type === "chunk" && typeof event.data === "string") {
            fullContent.push(event.data)
            reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
          } else if (event.type === "usage") {
            if (usageStore && userId) {
              const u = event.data as { prompt_tokens: number; completion_tokens: number; total_tokens: number }
              usageStore.record({
                id: randomUUID(),
                userId,
                conversationId: conv.id,
                model,
                providerLabel: providerLabel || "default",
                promptTokens: u.prompt_tokens,
                completionTokens: u.completion_tokens,
                totalTokens: u.total_tokens,
                cost: pricing.computeCost(model, u.prompt_tokens, u.completion_tokens),
                createdAt: Date.now(),
              })
            }
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
        const stream = provider.chatStream({
          model: body.model,
          messages: reinferenceMessages,
          stream: true,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
        })
        for await (const event of stream) {
          if (event.type === "chunk" && typeof event.data === "string") {
            fullContent.push(event.data)
            reply.raw.write(serializeStreamChunk(`chat_${Date.now()}`, body.model, event.data))
          } else if (event.type === "usage") {
            if (usageStore && userId) {
              const u = event.data as { prompt_tokens: number; completion_tokens: number; total_tokens: number }
              usageStore.record({
                id: randomUUID(),
                userId,
                conversationId: conv.id,
                model,
                providerLabel: providerLabel || "default",
                promptTokens: u.prompt_tokens,
                completionTokens: u.completion_tokens,
                totalTokens: u.total_tokens,
                cost: pricing.computeCost(model, u.prompt_tokens, u.completion_tokens),
                createdAt: Date.now(),
              })
            }
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
      // Don't load providers on the wizard if there's no token yet (first visit)
      const token = localStorage.getItem("engramic_token")
      if (token) await this.loadProviders()
      else this.loaded = true
    },
    async init() {
      await this.loadProviders()
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
        if (!data.ok) {
          this.testError = data.error || "Connection failed"
          return
        }
        this.allModels = data.models || []
        this.tested = true
        if (this.allModels.length > 0) {
          this.form.selectedModels = [this.allModels[0].id]
        }
      } catch (e) {
        this.testError = e.message
      } finally {
        this.testing = false
      }
    },
    toggleModel(id) {
      const idx = this.form.selectedModels.indexOf(id)
      if (idx >= 0) this.form.selectedModels.splice(idx, 1)
      else this.form.selectedModels.push(id)
    },
    canProceedFromModels() {
      return this.form.useWildcard || this.form.selectedModels.length > 0
    },
    async testChat() {
      this.chatTest.loading = true
      this.chatTest.error = ""
      this.chatTest.result = ""
      this.chatTest.validated = false
      const model = this.form.useWildcard
        ? (this.allModels[0]?.id || "")
        : (this.form.selectedModels[0] || "")
      if (!model) { this.chatTest.error = "No model selected"; this.chatTest.loading = false; return }
      try {
        const data = await this.api("/test-chat", {
          method: "POST",
          body: JSON.stringify({ base_url: this.form.baseUrl, api_key: this.form.apiKey, provider: this.form.providerType, model: model }),
        })
        if (!data.ok) {
          this.chatTest.error = data.error || "Chat test failed"
          return
        }
        this.chatTest.result = data.response
        this.chatTest.validated = true
      } catch (e) {
        this.chatTest.error = e.message
      } finally {
        this.chatTest.loading = false
      }
    },
    modelSummary() {
      if (this.form.useWildcard) return "Any"
      return this.form.selectedModels.join(", ")
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
    async saveProvider() {
      const f = this.form
      if (!f.label || !f.apiKey) { this.notify("Label and API key are required", "err"); return }
      this.saving = true
      try {
        const defaultModel = f.useWildcard ? "*" : (f.selectedModels[0] || "")
        const data = await this.api("/register", {
          method: "POST",
          body: JSON.stringify({
            label: f.label,
            api_key: f.apiKey,
            base_url: f.baseUrl,
            default_model: defaultModel,
            provider: f.providerType,
          }),
        })
        if (data.token) {
          localStorage.setItem("engramic_token", data.token)
        }
        this.notify("Provider saved")
        f.apiKey = ""
        f.baseUrl = ""
        f.selectedModels = []
        f.useWildcard = false
        f.label = ""
        this.step = 1
        this.tested = false
        this.chatTest = { loading: false, result: "", error: "", validated: false }
        await this.loadProviders()
      } catch (e) {
        this.notify(e.message, "err")
      }
      this.saving = false
    },
    async removeProvider(label) {
      if (!confirm("Remove provider \"" + label + "\"?")) return
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
    async init() {
      await this.loadProviders()
      await this.loadProfiles()
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
    async loadProviders() {
      try {
        const data = await this.api("/providers")
        this.providers = data.providers || []
      } catch (e) {
        this.notify(e.message, "err")
      }
      this.loaded = true
    },
    async loadProfiles() {
      try {
        const data = await this.api("/v1/profiles")
        this.profiles = data.profiles || []
      } catch (e) {
        console.error("Failed to load profiles:", e)
      }
      this.profilesLoaded = true
    },
    async removeProvider(label) {
      if (!confirm("Remove provider \"" + label + "\"?")) return
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
    form: {
      name: "",
      executionProvider: "",
      executionModel: "*",
      contextWindow: 128000,
    },
    async init() {
      await this.loadProviders()
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
    async loadProviders() {
      try {
        const data = await this.api("/providers")
        this.providers = data.providers || []
        if (this.providers.length > 0) this.form.executionProvider = this.providers[0].label
      } catch (e) {
        console.error("Failed to load providers:", e)
      }
    },
    async saveProfile() {
      this.saving = true
      try {
        await this.api("/v1/profiles", {
          method: "POST",
          body: JSON.stringify({
            name: this.form.name,
            execution: { provider: this.form.executionProvider, model: this.form.executionModel },
            contextWindow: this.form.contextWindow,
          }),
        })
        this.notify("Profile created")
        window.location.href = "/"
      } catch (e) {
        this.notify(e.message, "err")
      }
      this.saving = false
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

const CHATS_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>engramic — Chat Browser</title>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; height: 100vh; overflow: hidden; }
  .layout { display: flex; height: 100vh; }
  .sidebar { width: 320px; min-width: 320px; border-right: 1px solid #30363d; display: flex; flex-direction: column; background: #161b22; }
  .sidebar-header { padding: 16px; border-bottom: 1px solid #30363d; }
  .sidebar-header h1 { font-size: 1.1rem; color: #f0f6fc; }
  .sidebar-header .sub { color: #8b949e; font-size: 0.75rem; margin-top: 2px; }
  .sidebar-search { padding: 12px 16px; border-bottom: 1px solid #30363d; }
  .sidebar-search input { width: 100%; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; outline: none; }
  .sidebar-search input:focus { border-color: #58a6ff; }
  .conv-list { flex: 1; overflow-y: auto; }
  .conv-item { padding: 12px 16px; border-bottom: 1px solid #21262d; cursor: pointer; transition: background 0.15s; }
  .conv-item:hover { background: #1c2128; }
  .conv-item.active { background: #1f6feb22; border-left: 3px solid #58a6ff; }
  .conv-item .id { font-size: 0.85rem; font-weight: 600; color: #f0f6fc; margin-bottom: 4px; }
  .conv-item .meta { font-size: 0.75rem; color: #8b949e; display: flex; gap: 12px; }
  .conv-item .meta span { display: flex; align-items: center; gap: 3px; }
  .conv-item .preview { font-size: 0.8rem; color: #6e7681; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .main-header { padding: 16px 20px; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between; }
  .main-header h2 { font-size: 1rem; color: #f0f6fc; }
  .main-header .stats { font-size: 0.75rem; color: #8b949e; display: flex; gap: 16px; }
  .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; color: #484f58; font-size: 0.9rem; flex-direction: column; gap: 8px; }
  .empty-state .big-icon { font-size: 2rem; opacity: 0.3; }
  .timeline { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px; background: #21262d; border-radius: 8px; overflow: hidden; border: 1px solid #30363d; }
  .grid-header { background: #1c2128; padding: 8px 12px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; text-align: center; }
  .grid-header.user { color: #58a6ff; }
  .grid-header.hidden { color: #d2a8ff; }
  .grid-header.system { color: #3fb950; }
  .cell { background: #0d1117; padding: 12px; min-height: 40px; font-size: 0.85rem; line-height: 1.5; }
  .cell.empty { color: #21262d; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
  .cell.user { color: #c9d1d9; }
  .cell.hidden { color: #d2a8ff; }
  .cell.system { color: #3fb950; }
  .tool-name { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: #2d1b4e; color: #d2a8ff; margin-bottom: 4px; font-family: monospace; }
  .tool-detail { margin-top: 6px; font-family: monospace; font-size: 0.75rem; background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; color: #8b949e; }
  .expand-btn { background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 0.75rem; padding: 2px 0; }
  .expand-btn:hover { text-decoration: underline; }
  .sys-event { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; background: #1c3a1c; color: #7ee787; margin-bottom: 4px; }
  .msg-text { word-break: break-word; }
  .msg-text.collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .timestamp { font-size: 0.65rem; color: #484f58; margin-top: 4px; }
  .badge-count { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; background: #1f6feb22; color: #58a6ff; }
  .tool-count { background: #2d1b4e; color: #d2a8ff; }
  .compression-event { background: #1c3a1c; color: #7ee787; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; border: 1px solid #2d5a2d; }
</style>
</head>
<body>
<div class="layout" x-data="chatsApp()">
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>engramic</h1>
      <div class="sub">Chat Browser</div>
    </div>
    <div class="sidebar-search">
      <input type="text" x-model="search" placeholder="Search conversations..." @input.debounce="filterConversations()">
    </div>
    <div class="conv-list">
      <template x-if="!loaded">
        <div class="empty-state" style="padding:40px 16px">Loading...</div>
      </template>
      <template x-if="loaded && filteredConversations.length === 0">
        <div class="empty-state" style="padding:40px 16px">No conversations found</div>
      </template>
      <template x-for="c in filteredConversations" :key="c.id">
        <div class="conv-item" :class="{ active: selectedId === c.id }" @click="selectConversation(c.id)">
          <div class="id" x-text="c.id"></div>
          <div class="meta">
            <span x-text="formatDate(c.updatedAt)"></span>
            <span x-text="c.messageCount + ' msgs'"></span>
            <span x-show="c.toolCallCount > 0" class="tool-count badge-count" x-text="c.toolCallCount + ' tools'"></span>
          </div>
          <div class="preview" x-text="c.preview || '(no content)'"></div>
        </div>
      </template>
    </div>
  </div>
  <div class="main">
    <template x-if="!selectedId">
      <div class="empty-state">
        <div class="big-icon">&#x1F4AC;</div>
        <div>Select a conversation to browse</div>
      </div>
    </template>
    <template x-if="selectedId && !loadingTimeline">
      <template x-if="timeline.length === 0">
        <div class="empty-state">
          <div>No timeline entries</div>
        </div>
      </template>
      <template x-if="timeline.length > 0">
        <div>
          <div class="main-header">
            <div>
              <h2 x-text="selectedId"></h2>
              <div class="stats">
                <span x-text="timeline.length + ' events'"></span>
                <span x-text="'User: ' + timeline.filter(e => e.type === 'user').length"></span>
                <span x-text="'Hidden: ' + timeline.filter(e => e.type === 'hidden').length"></span>
                <span x-text="'System: ' + timeline.filter(e => ['assistant','system','compression','expansion','search','info'].includes(e.type)).length"></span>
              </div>
            </div>
          </div>
          <div class="timeline" x-data="{ expanded: {} }">
            <div class="grid">
              <div class="grid-header user">User</div>
              <div class="grid-header hidden">Hidden</div>
              <div class="grid-header system">System</div>
              <template x-for="(entry, i) in timeline" :key="i">
                  <template x-if="entry.type === 'user'">
                    <div class="cell user">
                      <div class="msg-text" :class="{ collapsed: entry.content && entry.content.length > 300 }" x-text="entry.content"></div>
                      <button x-show="entry.content && entry.content.length > 300" class="expand-btn" @click="expanded['u'+i]=!expanded['u'+i]" x-text="expanded['u'+i] ? 'Collapse' : 'Expand'"></button>
                      <div class="timestamp" x-text="formatTime(entry.timestamp)"></div>
                    </div>
                  </template>
                  <template x-if="entry.type === 'hidden'">
                    <div class="cell hidden" @click="expanded['h'+i]=!expanded['h'+i]" style="cursor:pointer">
                      <div class="tool-name" x-text="entry.toolName"></div>
                      <div class="timestamp" x-text="formatTime(entry.timestamp)"></div>
                      <template x-if="expanded['h'+i]">
                        <div class="tool-detail">
                          <div style="color:#d2a8ff;margin-bottom:4px">Arguments:</div>
                          <div x-text="JSON.stringify(entry.arguments, null, 2)"></div>
                          <div style="color:#d2a8ff;margin:8px 0 4px" x-show="entry.result">Result:</div>
                          <div x-show="entry.result" x-text="entry.result"></div>
                        </div>
                      </template>
                    </div>
                  </template>
                  <template x-if="entry.type === 'assistant' || entry.type === 'system'">
                    <div class="cell system">
                      <div class="msg-text" :class="{ collapsed: entry.content && entry.content.length > 300 }" x-text="entry.content"></div>
                      <button x-show="entry.content && entry.content.length > 300" class="expand-btn" @click="expanded['s'+i]=!expanded['s'+i]" x-text="expanded['s'+i] ? 'Collapse' : 'Expand'"></button>
                      <div class="timestamp" x-text="formatTime(entry.timestamp)"></div>
                    </div>
                  </template>
                  <template x-if="entry.type === 'compression' || entry.type === 'expansion' || entry.type === 'search' || entry.type === 'info'">
                    <div class="cell system">
                      <div class="sys-event" x-text="entry.type"></div>
                      <div x-text="entry.description"></div>
                      <div class="timestamp" x-text="formatTime(entry.timestamp)"></div>
                    </div>
                  </template>
              </template>
            </div>
          </div>
        </div>
      </template>
    </template>
    <template x-if="selectedId && loadingTimeline">
      <div class="empty-state">Loading...</div>
    </template>
  </div>
</div>
<script>
document.addEventListener("alpine:init", () => {
  Alpine.data("chatsApp", () => ({
    loaded: false,
    conversations: [],
    filteredConversations: [],
    search: "",
    selectedId: null,
    timeline: [],
    loadingTimeline: false,
    async init() {
      await this.loadConversations()
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
    async loadConversations() {
      try {
        const data = await this.api("/api/conversations")
        this.conversations = data.conversations || []
        this.filteredConversations = [...this.conversations]
      } catch (e) {
        console.error("Failed to load conversations:", e)
      }
      this.loaded = true
    },
    filterConversations() {
      const q = this.search.toLowerCase()
      if (!q) { this.filteredConversations = [...this.conversations]; return }
      this.filteredConversations = this.conversations.filter((c) =>
        c.id.toLowerCase().includes(q) || (c.preview || "").toLowerCase().includes(q)
      )
    },
    async selectConversation(id) {
      this.selectedId = id
      this.loadingTimeline = true
      this.timeline = []
      try {
        const data = await this.api("/api/conversations/" + encodeURIComponent(id))
        this.timeline = data.timeline || []
      } catch (e) {
        console.error("Failed to load conversation:", e)
      }
      this.loadingTimeline = false
    },
    formatDate(ts) {
      if (!ts) return ""
      const d = new Date(ts)
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    },
    formatTime(ts) {
      if (!ts) return ""
      const d = new Date(ts)
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    },
  }))
})
</script>
</body>
</html>`
