import type { Conversation, Message, SummaryNode } from "../types.js"

export interface ExpandMemoryRangeResult {
  messages: Message[]
  spanCount: number
  replacedSummaries: SummaryNode[]
}

export function executeExpandMemoryRange(
  conv: Conversation,
  startSpan: string,
  endSpan: string,
): ExpandMemoryRangeResult {
  const startIdx = conv.spans.findIndex((s) => s.id === startSpan)
  const endIdx = conv.spans.findIndex((s) => s.id === endSpan)

  if (startIdx === -1 || endIdx === -1) {
    return { messages: [], spanCount: 0, replacedSummaries: [] }
  }

  const from = Math.min(startIdx, endIdx)
  const to = Math.max(startIdx, endIdx)

  const messages: Message[] = []
  const replacedSummaries: SummaryNode[] = []

  for (let i = from; i <= to; i++) {
    const span = conv.spans[i]
    for (const sid of span.summaryIds) {
      const summary = conv.summaries.get(sid)
      if (summary) replacedSummaries.push(summary)
    }
    span.summaryIds = []
    messages.push(...span.messages)
  }

  return { messages, spanCount: to - from + 1, replacedSummaries }
}
