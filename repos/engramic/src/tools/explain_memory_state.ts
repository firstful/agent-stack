import type { Conversation, MemoryHandle, SummaryNode, TranscriptSpan } from "../types.js"

export interface ExplainMemoryStateResult {
  memory: MemoryHandle | null
  relatedSpans: TranscriptSpan[]
  relatedSummaries: SummaryNode[]
  transformations: string[]
  tokenImpact: {
    originalTokens: number
    compressedTokens: number
    savings: number
  } | null
  pinnedStatus: boolean
}

export function executeExplainMemoryState(
  conv: Conversation,
  memoryId?: string,
): ExplainMemoryStateResult {
  if (!memoryId) {
    const totalOriginal = conv.spans.reduce((s, sp) => s + sp.tokenCount, 0)
    const totalCompressed = Array.from(conv.summaries.values()).reduce((s, sm) => s + Math.ceil(sm.summaryText.length / 4), 0)

    return {
      memory: null,
      relatedSpans: [],
      relatedSummaries: Array.from(conv.summaries.values()),
      transformations: [
        `${conv.spans.length} total transcript spans`,
        `${conv.summaries.size} summary nodes`,
        `${conv.memories.length} memory handles of which ${conv.memories.filter((m) => m.pinned).length} are pinned`,
        `${conv.events.length} recorded events`,
      ],
      tokenImpact: {
        originalTokens: totalOriginal,
        compressedTokens: totalCompressed,
        savings: totalOriginal - totalCompressed,
      },
      pinnedStatus: false,
    }
  }

  const handle = conv.memories.find((m) => m.id === memoryId)
  if (!handle) {
    return {
      memory: null,
      relatedSpans: [],
      relatedSummaries: [],
      transformations: [`Memory handle ${memoryId} not found`],
      tokenImpact: null,
      pinnedStatus: false,
    }
  }

  const span = conv.spans.find((s) => s.id === handle.spanId)
  const summaries = span ? span.summaryIds.map((sid) => conv.summaries.get(sid)).filter(Boolean) as SummaryNode[] : []

  const transformations: string[] = []
  if (summaries.length > 0) {
    transformations.push(`Compressed into ${summaries.length} summary node(s)`)
    if (handle.pinned) {
      transformations.push(`Pinned: ${handle.pinReason || "No reason given"}`)
    }
  } else if (span) {
    transformations.push(`Active (not compressed) with ${span.messages.length} messages`)
  } else {
    transformations.push("No associated transcript span found")
  }

  const originalTokens = span?.tokenCount || 0
  const compressedTokens = summaries.reduce((s, sm) => s + Math.ceil(sm.summaryText.length / 4), 0)

  return {
    memory: handle,
    relatedSpans: span ? [span] : [],
    relatedSummaries: summaries,
    transformations,
    tokenImpact: span ? { originalTokens, compressedTokens, savings: originalTokens - compressedTokens } : null,
    pinnedStatus: !!handle.pinned,
  }
}
