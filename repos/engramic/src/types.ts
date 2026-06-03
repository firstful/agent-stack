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
  crossSession?: boolean
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
  type: "compression" | "expansion" | "search" | "info" | "prefetch"
  description: string
  details?: Record<string, unknown>
  timestamp: number
}

export type BudgetStrategy = "expand_recent" | "preserve_old" | "balanced" | "task_focus"

export type CompressionRate = "low" | "medium" | "high"

/**
 * Strategy for selecting which conversation spans to compress.
 * - "token_count": target spans with the highest token count first.
 * - "age": target the oldest spans first.
 * - "semantic_distance": target spans whose embedding is furthest from the
 *   recent conversation context.
 * - "auto": automatically select the best strategy based on conversation
 *   patterns (message frequency, topic drift, idle periods).
 */
export type CompressionStrategy = "token_count" | "age" | "semantic_distance" | "auto"

export type PrefetchStrategy = "trajectory" | "recency" | "hybrid"

export interface PrefetchConfig {
  enabled: boolean
  depth: number
  maxTokens: number
  strategy: PrefetchStrategy
  minConfidence: number
}

export interface MemoryPolicy {
  /** Active compression strategy for span selection */
  compressionStrategy: CompressionStrategy
  compressionRate: CompressionRate
  recencyBias: number
  retentionPriority: string[]
  /**
   * Override threshold for token_count strategy (default: 80_000).
   * The total conversation token count at which compression fires.
   */
  tokenThreshold?: number
  /**
   * Override threshold for age / message_count strategy (default: 20).
   * The number of user+assistant messages at which compression fires.
   */
  messageThreshold?: number
  /**
   * Override idle threshold in ms (default: 30_000).
   * How long the conversation can be idle before compression triggers.
   */
  idleThresholdMs?: number
  /**
   * For semantic_distance strategy: cosine distance threshold (default: 0.3).
   * Spans whose embedding is further than this from the recent topic centroid
   * are considered compressible.
   */
  semanticDistanceThreshold?: number
}

export interface MemoryDagNode {
  id: string
  spanId: string
  parentIds: string[]
  childIds: string[]
  expiredAt: number | null
  depth: number
  createdAt: number
}

export interface DagSubtreeQuery {
  /** Root node id to start traversal from */
  rootNodeId: string
  /** Max depth from root (0 = root only, 1 = children, etc). Default: unlimited */
  maxDepth?: number
  /** Whether to include expired nodes. Default: false */
  includeExpired?: boolean
  /** If set, filter nodes whose span topic/content matches */
  query?: string
}

export interface DagExpiryResult {
  expiredNodeIds: string[]
  expiredSpanIds: string[]
  totalNodesAffected: number
}

export interface Conversation {
  id: string
  spans: TranscriptSpan[]
  summaries: Map<string, SummaryNode>
  memories: MemoryHandle[]
  events: MemoryEvent[]
  toolCalls: ToolCallRecord[]
  systemEvents: SystemEvent[]
  dag: Map<string, MemoryDagNode>
  policy: MemoryPolicy
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
  prefetchConfig?: PrefetchConfig
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

export type RetentionTrigger = "memory_count" | "age_days" | "token_count"
export type RetentionAction = "evict_oldest" | "evict_lowest_importance" | "compress_to_summary"

export interface RetentionPolicy {
  maxMemories: number
  retentionDays: number
  maxTokens: number
  trigger: RetentionTrigger
  action: RetentionAction
  autoPinPriorities: string[]
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxMemories: 500,
  retentionDays: 90,
  maxTokens: 1_000_000,
  trigger: "memory_count",
  action: "evict_lowest_importance",
  autoPinPriorities: [],
}

export interface Profile {
  id: string
  name: string
  execution: ModelAssignment
  summarization: ModelAssignment
  embedding: ModelAssignment
  compression: ProfileCompression
  retention: RetentionPolicy
  contextWindow: number
  tools: string[]
  authToken: string
  modelPreferences: string[]
  createdAt: number
}

export interface CrossSessionMemory {
  id: string
  userId: string
  profileId?: string
  topic: string
  summaryText: string
  sourceConversationId: string
  sourceSpanIds: string[]
  importanceScore: number
  pinned: boolean
  pinReason?: string
  embeddingId?: string
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  metadata: Record<string, unknown>
}

export interface SessionStitchInfo {
  userId: string
  profileId?: string
  conversationIds: string[]
}

export interface Account {
  token: string
  providers: ProviderConfig[]
  profiles: Profile[]
  globalMemories?: MemoryHandle[]
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
  response_format?: ResponseFormat
  parallel_tool_calls?: boolean
  tool_choice?: string | { type: "function"; function: { name: string } }
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

// ── Responses API Types ──

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } }

export interface ResponsesApiRequest {
  input: string | Array<{
    role: string
    content: string | Array<Record<string, unknown>>
    [key: string]: unknown
  }>
  model: string
  instructions?: string
  tools?: unknown[]
  stream?: boolean
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  metadata?: Record<string, unknown>
  response_format?: ResponseFormat
  previous_response_id?: string
  tool_choice?: string | { type: "function"; function: { name: string } }
  parallel_tool_calls?: boolean
  store?: boolean
  user?: string
}

export interface ResponsesApiResponse {
  id: string
  object: "response"
  created: number
  model: string
  output: ResponseOutputItem[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

export type ResponseOutputItem = ResponseMessage | ResponseFunctionCall

export interface ResponseMessage {
  type: "message"
  id: string
  role: "assistant"
  content: ResponseContentPart[]
}

export interface ResponseContentPart {
  type: "output_text"
  text: string
  annotations?: unknown[]
}

export interface ResponseFunctionCall {
  type: "function_call"
  id: string
  name: string
  arguments: string
  status: "completed"
}

export function inputToMessages(input: ResponsesApiRequest["input"]): Array<{ role: string; content: string | Array<Record<string, unknown>>; [key: string]: unknown }> {
  if (typeof input === "string") {
    return [{ role: "user", content: input }]
  }
  return input as Array<{ role: string; content: string | Array<Record<string, unknown>> }>
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
  "predictive_prefetch",
] as const
export type HiddenToolName = (typeof HIDDEN_TOOLS)[number]
