import type {
  Conversation, TranscriptSpan, SummaryNode, MemoryHandle, Message,
  CompressionStrategy, MemoryPolicy,
} from "../types.js"
import type { Provider } from "../provider/index.js"
import type { EmbeddingsProvider } from "../provider/embeddings.js"
import type { IVectorStore } from "../memory/vector.js"
import { cosineSimilarity } from "../provider/embeddings.js"

// ── Default thresholds ──────────────────────────────────────────────────────

const DEFAULT_TOKEN_THRESHOLD = 80_000
const DEFAULT_MESSAGE_THRESHOLD = 20
const DEFAULT_IDLE_THRESHOLD_MS = 30_000
const DEFAULT_SEMANTIC_DISTANCE_THRESHOLD = 0.3

// ── Threshold helpers ───────────────────────────────────────────────────────

function getTokenThreshold(policy: MemoryPolicy): number {
  return policy.tokenThreshold ?? DEFAULT_TOKEN_THRESHOLD
}

function getMessageThreshold(policy: MemoryPolicy): number {
  return policy.messageThreshold ?? DEFAULT_MESSAGE_THRESHOLD
}

function getIdleThreshold(policy: MemoryPolicy): number {
  return policy.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS
}

function getSemanticDistanceThreshold(policy: MemoryPolicy): number {
  return policy.semanticDistanceThreshold ?? DEFAULT_SEMANTIC_DISTANCE_THRESHOLD
}

// ── Strategy 1: token_count ─────────────────────────────────────────────────

/**
 * Select spans with the highest token count first.
 * Produces the largest compression ratio per span.
 */
function selectByTokenCount(spans: TranscriptSpan[], count: number): TranscriptSpan[] {
  const candidates = spans
    .filter((s) => !s.messages.some((m) => m.role === "system"))
    .map((s) => ({ span: s, tokenCount: s.tokenCount }))
  candidates.sort((a, b) => b.tokenCount - a.tokenCount)
  return candidates.slice(0, Math.min(count, candidates.length)).map((c) => c.span)
}

// ── Strategy 2: age ─────────────────────────────────────────────────────────

/**
 * Select the oldest spans first (by createdAt).
 * Good for conversations where early history loses relevance.
 */
function selectByAge(spans: TranscriptSpan[], count: number): TranscriptSpan[] {
  const candidates = spans
    .filter((s) => !s.messages.some((m) => m.role === "system"))
  candidates.sort((a, b) => a.createdAt - b.createdAt)
  return candidates.slice(0, Math.min(count, candidates.length))
}

// ── Strategy 3: semantic_distance ───────────────────────────────────────────

/**
 * Build a text signature from a span for embedding comparison.
 */
function spanText(span: TranscriptSpan): string {
  return span.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join(" "))
    .join(" ")
}

/**
 * Build a recent-context centroid text from the last N spans.
 */
function recentContextText(spans: TranscriptSpan[], n: number): string {
  return spans.slice(-n)
    .map(spanText)
    .filter(Boolean)
    .join("\n")
}

/**
 * Select spans whose embedding is furthest from the recent conversation
 * centroid.  Uses cosine similarity (1 = identical, 0 = orthogonal, -1 = opposite).
 * Spans with similarity below (1 - threshold) are candidates.
 */
async function selectBySemanticDistance(
  spans: TranscriptSpan[],
  policy: MemoryPolicy,
  embeddings: EmbeddingsProvider,
  vectorStore?: IVectorStore,
): Promise<TranscriptSpan[]> {
  const threshold = getSemanticDistanceThreshold(policy)
  const candidates = spans.filter((s) => !s.messages.some((m) => m.role === "system"))
  if (candidates.length === 0) return []

  // Build recent-context centroid from the newest 3 non-system spans
  const recent = recentContextText(candidates, 3)
  if (!recent.trim()) {
    // No non-system recent context — fall back to age-based
    return selectByAge(candidates, Math.max(1, Math.floor(candidates.length / 2)))
  }

  // If vector store has pre-computed embeddings, leverage it
  if (vectorStore) {
    const scored: Array<{ span: TranscriptSpan; similarity: number }> = []
    for (const span of candidates) {
      try {
        const text = spanText(span)
        if (!text.trim()) continue
        const similarity = await vectorStore.similarity(recent, text)
        scored.push({ span, similarity })
      } catch {
        // If vector store fails, fall through to embedding-based scoring
      }
    }

    if (scored.length > 0) {
      // Sort by similarity ascending (least similar to recent context first)
      scored.sort((a, b) => a.similarity - b.similarity)
      const cutoff = scored.filter((s) => s.similarity < 1 - threshold)
      if (cutoff.length === 0) {
        // All spans are close to recent context — take the least similar quarter
        return scored.slice(0, Math.max(1, Math.floor(scored.length / 4))).map((s) => s.span)
      }
      return cutoff.map((s) => s.span)
    }
  }

  // Fallback: use embeddings provider directly
  try {
    const recentVec = await embeddings.embed(recent)
    const scored: Array<{ span: TranscriptSpan; distance: number }> = []

    for (const span of candidates) {
      const text = spanText(span)
      if (!text.trim()) continue
      const spanVec = await embeddings.embed(text)
      const sim = cosineSimilarity(recentVec, spanVec)
      scored.push({ span, distance: 1 - sim })
    }

    scored.sort((a, b) => b.distance - a.distance)
    const cutoff = scored.filter((s) => s.distance > threshold)

    if (cutoff.length === 0) {
      // All spans are close to recent context — take the furthest quarter
      return scored.slice(0, Math.max(1, Math.floor(scored.length / 4))).map((s) => s.span)
    }

    return cutoff.map((s) => s.span)
  } catch {
    // Embedding failure — fall back to token_count
    return selectByTokenCount(candidates, Math.max(1, Math.floor(candidates.length / 2)))
  }
}

// ── Auto strategy selection ─────────────────────────────────────────────────

interface ConversationPattern {
  /** Average time between message spans in ms */
  avgInterSpanGap: number
  /** Standard deviation of inter-span gaps */
  gapStdDev: number
  /** Ratio of system messages to total messages */
  systemMessageRatio: number
  /** Ratio of pinned spans to total spans */
  pinRatio: number
  /** Number of distinct topics detected via event markers */
  distinctTopics: number
  /** Total token count */
  totalTokens: number
  /** Total message count */
  totalMessages: number
  /** Average messages per span */
  avgMessagesPerSpan: number
}

function analyzePattern(conv: Conversation): ConversationPattern {
  const spans = conv.spans
  const timestamps = spans.map((s) => s.createdAt).sort((a, b) => a - b)

  let avgGap = 0
  let gapVariance = 0
  if (timestamps.length > 1) {
    const gaps: number[] = []
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1])
    }
    avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
    gapVariance = gaps.reduce((a, b) => a + (b - avgGap) ** 2, 0) / gaps.length
  }

  const totalMessages = spans.reduce((s, sp) => s + sp.messages.length, 0)
  const systemMessages = spans.reduce((s, sp) => s + sp.messages.filter((m) => m.role === "system").length, 0)
  const pinnedSpans = spans.filter((s) => s.messages.some((m) => m.metadata?.pinned)).length
  const totalTokens = spans.reduce((s, sp) => s + sp.tokenCount, 0)

  const topicEvents = conv.events
    .filter((e) => e.type === "decision" || e.type === "fact")
    .map((e) => e.content)

  return {
    avgInterSpanGap: avgGap,
    gapStdDev: Math.sqrt(gapVariance),
    systemMessageRatio: totalMessages > 0 ? systemMessages / totalMessages : 0,
    pinRatio: spans.length > 0 ? pinnedSpans / spans.length : 0,
    distinctTopics: new Set(topicEvents).size,
    totalTokens,
    totalMessages,
    avgMessagesPerSpan: spans.length > 0 ? totalMessages / spans.length : 0,
  }
}

/**
 * Automatically select the best compression strategy based on conversation
 * patterns observed so far.
 *
 * Heuristics:
 * - High token count relative to message count → large messages → token_count
 * - Large gaps between spans → age (older context becomes less relevant)
 * - High pin ratio + many spans → age (pinned spans protect valuable context, compress old)
 * - Many events/topics + high message count → semantic_distance (topic drift)
 * - High system message ratio → likely structured/templated → token_count
 * - Default / low confidence → "token_count" (simplest, most predictable)
 */
export function autoSelectStrategy(conv: Conversation): CompressionStrategy {
  const pattern = analyzePattern(conv)
  const isAggressive = conv.policy.compressionRate === "high"

  // If very few spans, token_count is sufficient
  if (conv.spans.length < 3) {
    return "token_count"
  }

  // High gap standard deviation relative to mean → irregular conversation → compress oldest
  if (pattern.avgInterSpanGap > 60_000 && pattern.gapStdDev / Math.max(pattern.avgInterSpanGap, 1) > 0.5) {
    return "age"
  }

  // High pin ratio → user curating context → compress old stuff, keep relevant
  if (pattern.pinRatio > 0.3 && conv.spans.length > 5) {
    return "age"
  }

  // Many distinct topics with high message count → topic drift likely → semantic
  // Lower threshold when compression rate is high
  const topicThreshold = isAggressive ? 2 : 3
  const messageThreshold = isAggressive ? 20 : 30
  if (pattern.distinctTopics > topicThreshold && pattern.totalMessages > messageThreshold) {
    return "semantic_distance"
  }

  // High system message ratio → templated interactions → compress by tokens
  if (pattern.systemMessageRatio > 0.3) {
    return "token_count"
  }

  // High token-to-message ratio → long messages → compress by tokens
  if (pattern.totalTokens > 0 && pattern.avgMessagesPerSpan > 0) {
    const avgTokensPerMessage = pattern.totalTokens / pattern.totalMessages
    if (avgTokensPerMessage > 500) {
      return "token_count"
    }
  }

  // With high compression rate, prefer age-based (clears the most history)
  if (isAggressive) {
    return "age"
  }

  // Default
  return "token_count"
}

// ── Top-level selector ──────────────────────────────────────────────────────

export type SelectedSpansResult = {
  spans: TranscriptSpan[]
  strategy: CompressionStrategy
  reason: string
}

/**
 * Select spans for compression using the conversation's configured strategy,
 * with auto-select fallback when strategy is "auto".
 */
export async function selectSpansForCompression(
  conv: Conversation,
  embeddings?: EmbeddingsProvider,
  vectorStore?: IVectorStore,
): Promise<SelectedSpansResult> {
  const policy = conv.policy
  let strategy: CompressionStrategy = policy.compressionStrategy

  // Resolve "auto" to a concrete strategy
  if (strategy === "auto") {
    strategy = autoSelectStrategy(conv)
  }

  // Respect compressionRate: low → 25%, medium → 50%, high → 75%
  let targetRatio: number
  switch (policy.compressionRate) {
    case "low":
      targetRatio = 0.25
      break
    case "high":
      targetRatio = 0.75
      break
    case "medium":
    default:
      targetRatio = 0.5
      break
  }
  const targetCount = Math.max(1, Math.floor(conv.spans.length * targetRatio))
  let selected: TranscriptSpan[]
  let reason: string

  switch (strategy) {
    case "token_count": {
      selected = selectByTokenCount(conv.spans, targetCount)
      reason = `token_count: selected ${selected.length} span(s) by highest token count`
      break
    }
    case "age": {
      selected = selectByAge(conv.spans, targetCount)
      reason = `age: selected ${selected.length} oldest span(s)`
      break
    }
    case "semantic_distance": {
      if (embeddings) {
        selected = await selectBySemanticDistance(conv.spans, policy, embeddings, vectorStore)
        reason = `semantic_distance: selected ${selected.length} span(s) furthest from recent context`
      } else {
        // No embeddings provider available — fall back to token_count
        selected = selectByTokenCount(conv.spans, targetCount)
        reason = `semantic_distance requested but no embeddings provider; fell back to token_count`
        strategy = "token_count"
      }
      break
    }
    default: {
      selected = selectByTokenCount(conv.spans, targetCount)
      reason = `token_count (default): selected ${selected.length} span(s) by highest token count`
      strategy = "token_count"
    }
  }

  // Filter out any spans that already have summaries (already compressed)
  const uncompressed = selected.filter((s) => s.summaryIds.length === 0)
  if (uncompressed.length === 0 && selected.length > 0) {
    // All selected spans already compressed — pick some that aren't
    const remaining = conv.spans.filter(
      (s) => !selected.includes(s) && s.summaryIds.length === 0 && !s.messages.some((m) => m.role === "system"),
    )
    if (remaining.length > 0) {
      return selectSpansForCompression(
        { ...conv, spans: remaining },
        embeddings,
        vectorStore,
      )
    }
  }

  return {
    spans: uncompressed.length > 0 ? uncompressed : selected,
    strategy,
    reason,
  }
}

// ── Should compress? ────────────────────────────────────────────────────────

/**
 * Check whether the conversation meets the threshold for compression.
 * Respects the active policy's thresholds (or defaults).
 */
export function shouldCompress(conv: Conversation): boolean {
  const policy = conv.policy

  // Compression rate adjusts sensitivity: high → lower thresholds (more aggressive),
  // low → higher thresholds (less aggressive)
  const rateMultiplier = policy.compressionRate === "high"
    ? 0.75
    : policy.compressionRate === "low"
      ? 1.25
      : 1.0

  // If strategy is "auto", use heuristics to determine threshold
  const totalTokens = conv.spans.reduce((sum, s) => sum + s.tokenCount, 0)
  const totalMessages = conv.spans.reduce((sum, s) => sum + s.messages.length, 0)

  if (totalTokens > getTokenThreshold(policy) * rateMultiplier) return true
  if (totalMessages > getMessageThreshold(policy) * rateMultiplier) return true

  // Idle check — more aggressive with higher rate (shorter idle wait)
  const idleThreshold = policy.compressionRate === "high"
    ? Math.min(getIdleThreshold(policy), 15_000)
    : policy.compressionRate === "low"
      ? Math.max(getIdleThreshold(policy), 60_000)
      : getIdleThreshold(policy)
  if (Date.now() - conv.updatedAt > idleThreshold && totalTokens > 10_000) return true

  // For semantic_distance strategy, also check if there are enough spans
  // to make the strategy worthwhile
  if (policy.compressionStrategy === "semantic_distance" && conv.spans.length > 5) {
    return true
  }

  return false
}

// ── Summary prompt builder ──────────────────────────────────────────────────

function buildSummaryPrompt(spans: TranscriptSpan[]): string {
  const transcript = spans
    .flatMap((s) => s.messages)
    .map((m) => `${m.role}: ${m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join(" ")}`)
    .join("\n")

  return `Summarize the following conversation, preserving key decisions, architectural conclusions, unresolved tasks, and important context. Be detailed enough that the summary can substitute for the original transcript.

${transcript}`
}

// ── Core compression function ───────────────────────────────────────────────

/**
 * Compress the conversation using the active strategy.
 * Returns a MemoryHandle for the compressed region, or null if no compression needed.
 *
 * If embeddings / vectorStore are provided, the semantic_distance strategy
 * can be used, and embedding-based importance scoring is applied.
 */
export async function compressConversation(
  conv: Conversation,
  summarizationProvider: Provider,
  summarizationModel: string,
  embeddings?: EmbeddingsProvider,
  vectorStore?: IVectorStore,
): Promise<MemoryHandle | null> {
  if (!shouldCompress(conv)) return null

  const { spans: targets, strategy, reason } = await selectSpansForCompression(conv, embeddings, vectorStore)

  if (targets.length === 0) return null

  const summaryMsg: Message[] = [
    {
      id: `sys_${Date.now()}`,
      role: "system",
      content: [{ type: "text", text: `You are a conversation summarizer using ${strategy} compression strategy. Produce concise, information-dense summaries.` }],
    },
    {
      id: `usr_${Date.now()}`,
      role: "user",
      content: [{ type: "text", text: buildSummaryPrompt(targets) }],
    },
  ]

  const response = await summarizationProvider.chat({
    model: summarizationModel,
    messages: summaryMsg,
    max_tokens: 2000,
  })

  const summaryText = response.message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  const totalTokens = targets.reduce((sum, s) => sum + s.tokenCount, 0)
  const summaryTokens = Math.ceil(summaryText.length / 4)
  const compressionRatio = summaryTokens > 0 ? totalTokens / summaryTokens : 1

  const existingParentIds = [...new Set(targets.flatMap((s) => s.summaryIds))]
  const parentSummaryIds = existingParentIds.filter((id) => conv.summaries.has(id))

  const summaryNode: SummaryNode = {
    id: `sum_${Math.random().toString(36).slice(2, 9)}`,
    sourceSpanIds: targets.map((s) => s.id),
    summaryText,
    importanceScore: 0.5,
    compressionRatio,
    parentSummaryIds,
    childSummaryIds: [],
  }

  for (const parentId of parentSummaryIds) {
    const parent = conv.summaries.get(parentId)
    if (parent) {
      parent.childSummaryIds.push(summaryNode.id)
    }
  }

  conv.summaries.set(summaryNode.id, summaryNode)

  for (const span of targets) {
    span.summaryIds.push(summaryNode.id)
  }

  const topicText = summaryText.split(".").slice(0, 2).join(". ").slice(0, 80)
  const handle: MemoryHandle = {
    id: `mem_${Math.random().toString(36).slice(2, 9)}`,
    topic: topicText,
    turnRange: `${conv.spans.indexOf(targets[0]) + 1}-${conv.spans.indexOf(targets[targets.length - 1]) + 1}`,
    spanId: targets[0].id,
  }

  conv.memories.push(handle)

  if (embeddings && vectorStore) {
    try {
      const embeddingId = `emb_mem_${handle.id}`
      await vectorStore.insert(embeddingId, summaryText, handle.id, "memory")
      handle.embeddingId = embeddingId
      const ranked = await vectorStore.rankByImportance()
      const self = ranked.find((m) => m.record.id === embeddingId)
      if (self) summaryNode.importanceScore = self.score
    } catch (err) {
      console.error("Embedding generation failed during compression:", err)
    }
  }

  conv.updatedAt = Date.now()

  // Log the strategy decision as a system event
  conv.systemEvents.push({
    type: "compression",
    description: `Compressed ${targets.length} span(s) using ${strategy} strategy. Ratio: ${compressionRatio.toFixed(1)}x. ${reason}`,
    details: { strategy, spanIds: targets.map((s) => s.id), compressionRatio: Math.round(compressionRatio * 10) / 10 },
    timestamp: Date.now(),
  })

  return handle
}
