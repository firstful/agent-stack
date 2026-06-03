import type { Conversation } from "../types.js"
import {
  analyzeTrajectory,
  predictSpans,
  executePrefetch,
  defaultPrefetchConfig,
  shouldPrefetch,
  type PrefetchTrigger,
} from "./prefetch_engine.js"

export interface PredictivePrefetchResult {
  prefetched: boolean
  spansExpanded: number
  messagesExpanded: number
  tokensConsumed: number
  trigger: PrefetchTrigger
  predictions: Array<{ spanId: string; score: number; reason: string }>
  summary: string
}

export function executePredictivePrefetch(
  conv: Conversation,
  query?: string,
  depth?: number,
): PredictivePrefetchResult {
  const config = conv.prefetchConfig ?? defaultPrefetchConfig()
  const effectiveDepth = depth ?? config.depth
  const effectiveConfig = { ...config, depth: Math.min(effectiveDepth, 10) }

  // Analyze conversation trajectory
  const signals = analyzeTrajectory(conv)

  // Decide whether to prefetch
  const trigger = shouldPredictivePrefetchTrigger(conv, effectiveConfig, query)

  if (!trigger.triggered) {
    return {
      prefetched: false,
      spansExpanded: 0,
      messagesExpanded: 0,
      tokensConsumed: 0,
      trigger,
      predictions: [],
      summary: `Prefetch suppressed: ${trigger.reason}`,
    }
  }

  // Identify which spans are already in the working set (expanded spans)
  const expandedSpanIds = new Set(
    conv.spans.filter((s) => s.summaryIds.length === 0).map((s) => s.id),
  )

  // Predict which spans will be needed
  let predictions = predictSpans(conv, signals, effectiveConfig, expandedSpanIds)

  // If a query was provided, boost scores for spans matching the query
  if (query) {
    const queryLower = query.toLowerCase()
    const boosted = predictions.map((p) => {
      const span = conv.spans.find((s) => s.id === p.spanId)
      if (!span) return p
      const spanText = span.messages
        .flatMap((m) => m.content.filter((c) => c.type === "text"))
        .map((c) => (c as { type: "text"; text: string }).text)
        .join(" ")
        .toLowerCase()
      if (spanText.includes(queryLower)) {
        return { ...p, score: Math.min(p.score + 0.3, 1.0), reason: p.reason + ", query_match" }
      }
      return p
    })
    predictions = boosted.sort((a, b) => b.score - a.score).slice(0, effectiveConfig.depth)
  }

  // Execute the prefetch
  const result = executePrefetch(conv, predictions, effectiveConfig)

  // Record system event
  conv.systemEvents.push({
    type: "prefetch",
    description: `Predictive prefetch: ${result.prefetchedSpans.length} spans expanded (${result.consumedTokens} tokens), depth=${effectiveDepth}, trigger=${trigger.reason}`,
    details: {
      trigger: trigger.reason,
      prefetchedSpans: result.prefetchedSpans.map((s) => s.id),
      predictions: predictions.map((p) => ({ id: p.spanId, score: p.score, reason: p.reason })),
      tokensConsumed: result.consumedTokens,
      depth: effectiveDepth,
    },
    timestamp: Date.now(),
  })

  conv.updatedAt = Date.now()

  return {
    prefetched: result.prefetchedSpans.length > 0,
    spansExpanded: result.prefetchedSpans.length,
    messagesExpanded: result.prefetchedMessages.length,
    tokensConsumed: result.consumedTokens,
    trigger,
    predictions: result.predictions,
    summary: result.prefetchedSpans.length > 0
      ? `Prefetched ${result.prefetchedSpans.length} spans (${result.prefetchedMessages.length} messages, ${result.consumedTokens} tokens). Trigger: ${trigger.reason}.`
      : `No spans prefetched. Trigger: ${trigger.reason}.`,
  }
}

function shouldPredictivePrefetchTrigger(
  conv: Conversation,
  config: { enabled: boolean; depth: number; maxTokens: number; strategy: string; minConfidence: number },
  explicitQuery?: string,
): PrefetchTrigger {
  // If a query was explicitly provided, always attempt prefetch
  if (explicitQuery) {
    return { triggered: true, reason: "explicit_query" }
  }

  // Fall through to automatic trigger check
  return shouldPrefetch(conv, config as any)
}
