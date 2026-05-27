export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: { url: string; detail?: string }
}

export interface ToolCallPart {
  type: "tool_call"
  id: string
  function: { name: string; arguments: string }
}

export interface ToolResultPart {
  type: "tool_result"
  tool_call_id: string
  content: string
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart

export interface Message {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: ContentPart[]
  metadata?: Record<string, unknown>
}

export interface TranscriptSpan {
  id: string
  messages: Message[]
  createdAt: number
  summaryIds: string[]
  embeddingIds: string[]
  tokenCount: number
}

export interface SummaryNode {
  id: string
  sourceSpanIds: string[]
  summaryText: string
  importanceScore: number
  compressionRatio: number
  parentSummaryIds: string[]
  childSummaryIds: string[]
}

export interface MemoryHandle {
  id: string
  topic: string
  turnRange: string
  spanId: string
  pinned?: boolean
  pinReason?: string
  embeddingId?: string
}

export interface MemoryEvent {
  id: string
  type: "decision" | "fact" | "task" | "correction"
  content: string
  timestamp: number
  spanId?: string
}

export interface ToolCallRecord {
  name: string
  arguments: Record<string, unknown>
  result: string
  timestamp: number
}

export interface SystemEvent {
  type: "compression" | "expansion" | "search" | "info"
  description: string
  details?: Record<string, unknown>
  timestamp: number
}

export type BudgetStrategy = "expand_recent" | "preserve_old" | "balanced" | "task_focus"

export type CompressionRate = "low" | "medium" | "high"

export interface MemoryPolicy {
  compressionRate: CompressionRate
  recencyBias: number
  retentionPriority: string[]
}

export interface Conversation {
  id: string
  spans: TranscriptSpan[]
  summaries: Map<string, SummaryNode>
  memories: MemoryHandle[]
  events: MemoryEvent[]
  toolCalls: ToolCallRecord[]
  systemEvents: SystemEvent[]
  policy: MemoryPolicy
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
}

export interface ProviderConfig {
  label: string
  providerType: string
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface ModelAssignment {
  provider: string
  model: string
}

export interface ProfileCompression {
  trigger: "token_count" | "message_count" | "idle_time"
  threshold: number
  rate: "low" | "medium" | "high"
}

export interface Profile {
  id: string
  name: string
  execution: ModelAssignment
  summarization: ModelAssignment
  embedding: ModelAssignment
  compression: ProfileCompression
  contextWindow: number
  tools: string[]
  authToken: string
  modelPreferences: string[]
  createdAt: number
}

export interface Account {
  token: string
  providers: ProviderConfig[]
  profiles: Profile[]
  createdAt: number
}

export interface RegisterRequest {
  provider?: string
  api_key: string
  base_url?: string
  default_model?: string
  label?: string
}

export interface RegisterProviderRequest {
  label: string
  provider?: string
  api_key: string
  base_url?: string
  default_model?: string
}

export interface RegisterResponse {
  token: string
  label: string
  provider: string
  default_model: string
  models: string[]
}

export interface AddProviderResponse {
  label: string
  provider: string
  default_model: string
  models: string[]
}

export interface ProviderCapabilities {
  tools: boolean
  streaming: boolean
  vision: boolean
  jsonMode: boolean
  parallelToolCalls: boolean
  reasoningTokens: boolean
}

export interface ProviderRequest {
  model: string
  messages: Message[]
  tools?: unknown[]
  stream?: boolean
  max_tokens?: number
  temperature?: number
  [key: string]: unknown
}

export interface ProviderResponse {
  id: string
  model: string
  message: Message
  finish_reason: string | null
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ProviderStreamEvent {
  type: "chunk" | "done" | "error" | "tool_call" | "usage"
  data: unknown
}

export interface ChatCompletionRequest {
  model: string
  messages: Array<{
    role: string
    content: string | Array<Record<string, unknown>>
    [key: string]: unknown
  }>
  stream?: boolean
  max_tokens?: number
  temperature?: number
  tools?: unknown[]
  [key: string]: unknown
}

export interface TokenBudget {
  maxTokens: number
  systemReserve: number
  workingSetReserve: number
  summaryReserve: number
  currentUsage: number
}

export interface UsageRecord {
  id: string
  userId: string
  conversationId: string
  model: string
  providerLabel: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  createdAt: number
}

export interface PricingEntry {
  modelPrefix: string
  inputPer1K: number
  outputPer1K: number
}

export interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCost: number
  requestCount: number
  byModel: Record<string, { requests: number; promptTokens: number; completionTokens: number; cost: number }>
}

export interface UsageMetrics {
  compressionRatio: number
  memoryExpansionRate: number
  averageTokenSavings: number
  summaryHitRate: number
  providerLatency: number
  rehydrationFrequency: number
}

export const HIDDEN_TOOLS = [
  "remember",
  "search_memory",
  "compress_memory",
  "expand_memory_range",
  "pin_memory",
  "unpin_memory",
  "query_memory_graph",
  "merge_memories",
  "budget_context",
  "set_memory_policy",
  "explain_memory_state",
  "simulate_expansion_cost",
  "mark_event",
  "rebuild_context_window",
] as const
export type HiddenToolName = (typeof HIDDEN_TOOLS)[number]
