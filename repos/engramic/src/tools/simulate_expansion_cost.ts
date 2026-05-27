import type { Conversation } from "../types.js"

export interface SimulateExpansionCostResult {
  memoryId: string
  found: boolean
  tokenCost: number
  messageCount: number
  compressedTokens: number
  savingsRatio: number
  recommendation: string
}

export function executeSimulateExpansionCost(
  conv: Conversation,
  memoryId: string,
): SimulateExpansionCostResult {
  const handle = conv.memories.find((m) => m.id === memoryId)

  if (!handle) {
    return {
      memoryId,
      found: false,
      tokenCost: 0,
      messageCount: 0,
      compressedTokens: 0,
      savingsRatio: 0,
      recommendation: "Memory handle not found",
    }
  }

  const span = conv.spans.find((s) => s.id === handle.spanId)
  if (!span) {
    return {
      memoryId,
      found: true,
      tokenCost: 0,
      messageCount: 0,
      compressedTokens: 0,
      savingsRatio: 0,
      recommendation: "No transcript span associated with this memory",
    }
  }

  const expansionTokens = span.tokenCount
  const compressedTokens = span.summaryIds.reduce((s, sid) => {
    const summary = conv.summaries.get(sid)
    return s + (summary ? Math.ceil(summary.summaryText.length / 4) : 0)
  }, 0)

  const savingsRatio = expansionTokens > 0 ? compressedTokens / expansionTokens : 0
  let recommendation: string

  if (expansionTokens > 8000) {
    recommendation = `Expansion costs ~${expansionTokens} tokens (${span.messages.length} messages). Consider expanding only if this memory is actively needed.`
  } else {
    recommendation = `Expansion costs ~${expansionTokens} tokens (${span.messages.length} messages). Low cost, safe to expand.`
  }

  return {
    memoryId,
    found: true,
    tokenCost: expansionTokens,
    messageCount: span.messages.length,
    compressedTokens,
    savingsRatio,
    recommendation,
  }
}
