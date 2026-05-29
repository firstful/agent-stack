import type { Conversation } from "../types.js"

export interface SimulateExpansionCostResult {
  memoryId: string
  found: boolean
  tokenCost: number
  messageCount: number
  compressedTokens: number
  savingsRatio: number
  recommendation: string
  expandedSpanIds: string[]
  parentSummaryIds: string[]
  parentSummaryTokens: number
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
      expandedSpanIds: [],
      parentSummaryIds: [],
      parentSummaryTokens: 0,
      recommendation: "Memory handle not found",
    }
  }

  const span = conv.spans.find((s) => s.id === handle.spanId)

  if (!span && handle.turnRange) {
    const [startStr, endStr] = handle.turnRange.split("-")
    const start = parseInt(startStr, 10) - 1
    const end = endStr ? parseInt(endStr, 10) : start
    const turnSpans = conv.spans.slice(start, end + 1)

    if (turnSpans.length === 0) {
      return {
        memoryId,
        found: true,
        tokenCost: 0,
        messageCount: 0,
        compressedTokens: 0,
        savingsRatio: 0,
        expandedSpanIds: [],
        parentSummaryIds: [],
        parentSummaryTokens: 0,
        recommendation: "No transcript spans found for the turn range",
      }
    }

    const expansionTokens = turnSpans.reduce((s, sp) => s + sp.tokenCount, 0)
    const messageCount = turnSpans.reduce((s, sp) => s + sp.messages.length, 0)
    const compressedTokens = turnSpans.reduce((s, sp) => {
      return s + sp.summaryIds.reduce((ss, sid) => {
        const summary = conv.summaries.get(sid)
        return ss + (summary ? Math.ceil(summary.summaryText.length / 4) : 0)
      }, 0)
    }, 0)

    const relatedSummaryIds = [...new Set(turnSpans.flatMap((sp) => sp.summaryIds))]
    const parentSummaryIds = relatedSummaryIds.filter((id) => conv.summaries.has(id))
    const parentSummaryTokens = parentSummaryIds.reduce((s, id) => {
      const summary = conv.summaries.get(id)
      return s + (summary ? Math.ceil(summary.summaryText.length / 4) : 0)
    }, 0)

    const savingsRatio = expansionTokens > 0 ? compressedTokens / expansionTokens : 0
    const expandedSpanIds = turnSpans.map((sp) => sp.id)
    const costPerMsg = messageCount > 0 ? Math.round(expansionTokens / messageCount) : 0

    const recommendation =
      expansionTokens > 8000
        ? `Expanding memory "${handle.topic}" costs ~${expansionTokens} tokens across ${turnSpans.length} spans (${messageCount} messages, ~${costPerMsg} tok/msg). ${compressedTokens} tokens stored in ${parentSummaryIds.length} summaries. Ratio: ${(savingsRatio * 100).toFixed(0)}%. Consider expanding only if actively needed.`
        : `Expanding memory "${handle.topic}" costs ~${expansionTokens} tokens across ${turnSpans.length} spans (${messageCount} messages, ~${costPerMsg} tok/msg). ${compressedTokens} tokens stored in ${parentSummaryIds.length} summaries. Ratio: ${(savingsRatio * 100).toFixed(0)}%. Low cost, safe to expand.`

    return {
      memoryId,
      found: true,
      tokenCost: expansionTokens,
      messageCount,
      compressedTokens,
      savingsRatio,
      expandedSpanIds,
      parentSummaryIds,
      parentSummaryTokens,
      recommendation,
    }
  }

  if (!span) {
    return {
      memoryId,
      found: true,
      tokenCost: 0,
      messageCount: 0,
      compressedTokens: 0,
      savingsRatio: 0,
      expandedSpanIds: [],
      parentSummaryIds: [],
      parentSummaryTokens: 0,
      recommendation: "No transcript span associated with this memory and no turnRange available",
    }
  }

  const expansionTokens = span.tokenCount
  const compressedTokens = span.summaryIds.reduce((s, sid) => {
    const summary = conv.summaries.get(sid)
    return s + (summary ? Math.ceil(summary.summaryText.length / 4) : 0)
  }, 0)

  const relatedSummaryIds = span.summaryIds.filter((id) => conv.summaries.has(id))
  const parentSummaryTokens = relatedSummaryIds.reduce((s, id) => {
    const summary = conv.summaries.get(id)
    return s + (summary ? Math.ceil(summary.summaryText.length / 4) : 0)
  }, 0)

  const savingsRatio = expansionTokens > 0 ? compressedTokens / expansionTokens : 0
  const expandedSpanIds = [span.id]
  const costPerMsg = span.messages.length > 0 ? Math.round(expansionTokens / span.messages.length) : 0

  const recommendation =
    expansionTokens > 8000
      ? `Expanding memory "${handle.topic}" costs ~${expansionTokens} tokens (${span.messages.length} messages, ~${costPerMsg} tok/msg). ${compressedTokens} tokens stored in ${relatedSummaryIds.length} summaries. Ratio: ${(savingsRatio * 100).toFixed(0)}%. Consider expanding only if actively needed.`
      : `Expanding memory "${handle.topic}" costs ~${expansionTokens} tokens (${span.messages.length} messages, ~${costPerMsg} tok/msg). ${compressedTokens} tokens stored in ${relatedSummaryIds.length} summaries. Ratio: ${(savingsRatio * 100).toFixed(0)}%. Low cost, safe to expand.`

  return {
    memoryId,
    found: true,
    tokenCost: expansionTokens,
    messageCount: span.messages.length,
    compressedTokens,
    savingsRatio,
    expandedSpanIds,
    parentSummaryIds: relatedSummaryIds,
    parentSummaryTokens,
    recommendation,
  }
}
