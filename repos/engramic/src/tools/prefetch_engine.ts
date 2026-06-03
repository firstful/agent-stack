import type { Conversation, TranscriptSpan, PrefetchConfig, PrefetchStrategy, MemoryEvent, SystemEvent, Message } from "../types.js"
import { estimateMessagesTokens } from "../provider/index.js"

// ── Public result types ──────────────────────────────────────────────────────

export interface TrajectorySignals {
  recentKeywords: string[]
  recentToolCalls: string[]
  recentMemoryTopics: string[]
  importantTopics: string[]
  hasActiveMemoryAccess: boolean
}

export interface SpanPrediction {
  spanId: string
  score: number
  reason: string
}

export interface PrefetchResult {
  prefetchedSpans: TranscriptSpan[]
  prefetchedMessages: Message[]
  predictions: SpanPrediction[]
  consumedTokens: number
}

export interface PrefetchTrigger {
  triggered: boolean
  reason: string
}

// ── Default config ──────────────────────────────────────────────────────────

const DEFAULT_PREFETCH_CONFIG: PrefetchConfig = {
  enabled: true,
  depth: 2,
  maxTokens: 4096,
  strategy: "hybrid",
  minConfidence: 0.3,
}

export function defaultPrefetchConfig(): PrefetchConfig {
  return { ...DEFAULT_PREFETCH_CONFIG }
}

// ── Trajectory analysis ─────────────────────────────────────────────────────

export function analyzeTrajectory(conv: Conversation, recentMessageCount = 5): TrajectorySignals {
  const recentKeywords = new Set<string>()
  const recentToolCalls: string[] = []
  const recentMemoryTopics = new Set<string>()
  const importantTopics = new Set<string>()

  // 1. Extract keywords from the last N messages
  const recentMessages = conv.spans
    .flatMap((s) => s.messages)
    .slice(-recentMessageCount)

  for (const msg of recentMessages) {
    for (const part of msg.content) {
      if (part.type === "text") {
        extractKeywords(part.text).forEach((k) => recentKeywords.add(k))
      }
    }
  }

  // 2. Look at recent tool calls (last 10)
  const recentCalls = conv.toolCalls.slice(-10)
  for (const tc of recentCalls) {
    recentToolCalls.push(tc.name)
    // If a memory-search tool was called, capture query terms
    if (tc.name === "search_memory" || tc.name === "query_memory_graph") {
      const args = tc.arguments
      const query = String(args.query || "")
      extractKeywords(query).forEach((k) => recentMemoryTopics.add(k))
    }
    if (tc.name === "remember" || tc.name === "expand_memory_range") {
      const args = tc.arguments
      for (const val of Object.values(args)) {
        if (typeof val === "string") {
          extractKeywords(val).forEach((k) => recentMemoryTopics.add(k))
        }
      }
    }
  }

  // 3. Collect topics from memory handles (especially pinned ones)
  for (const mem of conv.memories) {
    if (mem.pinned || (mem.topic && recentToolCalls.length > 0)) {
      extractKeywords(mem.topic).forEach((k) => importantTopics.add(k))
    }
  }

  // 4. Look at recent memory events
  const recentEvents = conv.events.slice(-10)
  for (const ev of recentEvents) {
    extractKeywords(ev.content).forEach((k) => {
      recentMemoryTopics.add(k)
      importantTopics.add(k)
    })
  }

  return {
    recentKeywords: Array.from(recentKeywords),
    recentToolCalls: Array.from(new Set(recentToolCalls)),
    recentMemoryTopics: Array.from(recentMemoryTopics),
    importantTopics: Array.from(importantTopics),
    hasActiveMemoryAccess: recentToolCalls.some((name) =>
      ["remember", "search_memory", "expand_memory_range", "query_memory_graph"].includes(name),
    ),
  }
}

// ── Span prediction ─────────────────────────────────────────────────────────

export function predictSpans(
  conv: Conversation,
  signals: TrajectorySignals,
  config: PrefetchConfig,
  excludeSpanIds: Set<string> = new Set(),
): SpanPrediction[] {
  const spans = conv.spans

  // Score each span
  const scored: Array<{ span: TranscriptSpan; score: number; reasons: string[] }> = []

  for (const span of spans) {
    // Skip spans already in the working set
    if (excludeSpanIds.has(span.id)) continue

    // Skip spans without summaries (they're already expanded)
    if (span.summaryIds.length === 0) continue

    let score = 0
    const reasons: string[] = []

    // Factor 1: text keyword overlap with trajectory
    const spanText = span.messages
      .flatMap((m) => m.content.filter((p): p is { type: "text"; text: string } => p.type === "text"))
      .map((p) => p.text)
      .join(" ")
    const spanKeywords = extractKeywords(spanText)

    let keywordOverlap = 0
    for (const keyword of signals.recentKeywords) {
      if (spanKeywords.includes(keyword)) keywordOverlap++
    }
    if (keywordOverlap > 0) {
      const overlapRatio = keywordOverlap / Math.max(signals.recentKeywords.length, 1)
      score += overlapRatio * 0.35
      reasons.push(`keyword_overlap:${keywordOverlap}`)
    }

    // Factor 2: memory topic overlap
    let topicOverlap = 0
    for (const topic of signals.recentMemoryTopics) {
      if (spanText.toLowerCase().includes(topic)) topicOverlap++
    }
    if (topicOverlap > 0) {
      score += (topicOverlap / Math.max(signals.recentMemoryTopics.length, 1)) * 0.25
      reasons.push(`topic_overlap:${topicOverlap}`)
    }

    // Factor 3: important/pinned topic match
    let importantOverlap = 0
    for (const topic of signals.importantTopics) {
      if (spanText.toLowerCase().includes(topic)) importantOverlap++
    }
    if (importantOverlap > 0) {
      score += (importantOverlap / Math.max(signals.importantTopics.length, 1)) * 0.20
      reasons.push(`important_match:${importantOverlap}`)
    }

    // Factor 4: recency bonus (newer spans get a small boost)
    if (spans.length > 1) {
      const ageIndex = spans.indexOf(span)
      const recencyFactor = ageIndex / (spans.length - 1)
      score += recencyFactor * 0.10
      reasons.push("recency")
    }

    // Factor 5: pin bonus - pinned spans get a significant boost
    const isPinnedSpan = conv.memories.some((m) => m.spanId === span.id && m.pinned)
    if (isPinnedSpan) {
      score += 0.10
      reasons.push("pinned")
    }

    if (score > 0) {
      scored.push({ span: span, score, reasons })
    }
  }

  // Sort by score descending, take top K (depth)
  const sorted = scored.sort((a, b) => b.score - a.score)
  const depth = Math.min(config.depth, sorted.length)

  return sorted.slice(0, depth).map((s) => ({
    spanId: s.span.id,
    score: Math.min(s.score, 1.0),
    reason: s.reasons.join(", "),
  }))
}

// ── Prefetch execution ──────────────────────────────────────────────────────

export function executePrefetch(
  conv: Conversation,
  predictions: SpanPrediction[],
  config: PrefetchConfig,
): PrefetchResult {
  const prefetchedMessages: Message[] = []
  const prefetchedSpans: TranscriptSpan[] = []
  let consumedTokens = 0

  for (const pred of predictions) {
    // Skip low-confidence predictions
    if (pred.score < config.minConfidence) continue

    const span = conv.spans.find((s) => s.id === pred.spanId)
    if (!span) continue

    // Skip if already expanded (no summaries)
    if (span.summaryIds.length === 0) continue

    // Estimate token cost
    const spanTokens = estimateMessagesTokens(span.messages)
    if (consumedTokens + spanTokens > config.maxTokens) {
      // Still record that we would have prefetched this, but note budget limit
      break
    }

    // Expand the span: clear its summaries and include its messages
    span.summaryIds = []
    prefetchedMessages.push(...span.messages)
    prefetchedSpans.push(span)
    consumedTokens += spanTokens
  }

  return {
    prefetchedSpans,
    prefetchedMessages,
    predictions,
    consumedTokens,
  }
}

// ── Trigger decision ────────────────────────────────────────────────────────

export function shouldPrefetch(
  conv: Conversation,
  config: PrefetchConfig,
): PrefetchTrigger {
  if (!config.enabled) return { triggered: false, reason: "prefetch_disabled" }

  // Don't prefetch if there are no spans to prefetch from
  const expandableCount = conv.spans.filter((s) => s.summaryIds.length > 0).length
  if (expandableCount === 0) return { triggered: false, reason: "no_expandable_spans" }

  // Don't prefetch on every request — only when there's memory activity or
  // sufficient conversation history to analyze trajectory
  if (conv.toolCalls.length < 2 && conv.spans.length < 3) {
    return { triggered: false, reason: "insufficient_history" }
  }

  // Trigger if there was recent memory access
  const recentToolCalls = conv.toolCalls.slice(-3)
  const hasRecentMemoryAccess = recentToolCalls.some((tc) =>
    ["remember", "search_memory", "expand_memory_range", "query_memory_graph"].includes(tc.name),
  )
  if (hasRecentMemoryAccess) {
    return { triggered: true, reason: "recent_memory_access" }
  }

  // Trigger if the conversation has enough spans
  if (conv.spans.length >= 5) {
    return { triggered: true, reason: "sufficient_history" }
  }

  return { triggered: false, reason: "no_trigger_conditions_met" }
}

// ── Span selector for prefetch depth ────────────────────────────────────────

export function selectSpansForPrefetch(
  conv: Conversation,
  predictions: SpanPrediction[],
): string[] {
  return predictions.map((p) => p.spanId)
}

// ── Keyword extraction helper ───────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "over", "after",
  "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "will", "would", "can", "could", "should",
  "may", "might", "shall", "i", "you", "he", "she", "it", "we", "they",
  "me", "my", "your", "this", "that", "these", "those", "not", "no",
  "yes", "ok", "okay", "please", "thanks", "thank", "just", "like",
  "also", "very", "well", "so", "if", "then", "else", "when", "where",
  "what", "which", "who", "how", "all", "each", "every", "some", "any",
  "both", "few", "more", "most", "other", "such", "only", "own", "same",
  "too", "really", "get", "got", "go", "going", "went", "come", "came",
  "make", "take", "know", "think", "see", "want", "give", "tell", "say",
  "use", "find", "need", "set", "put", "let", "try", "ask", "work",
])

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))

  // Deduplicate while preserving order
  const seen = new Set<string>()
  return words.filter((w) => {
    if (seen.has(w)) return false
    seen.add(w)
    return true
  })
}
