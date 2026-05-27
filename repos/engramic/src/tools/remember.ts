import type { Conversation, Message, SummaryNode } from "../types.js"

export interface RememberResult {
  messages: Message[] | null
  replacedSummary: SummaryNode | null
}

export function executeRemember(
  conv: Conversation,
  memoryId: string,
): RememberResult {
  const handle = conv.memories.find((m) => m.id === memoryId)
  if (!handle) return { messages: null, replacedSummary: null }

  const span = conv.spans.find((s) => s.id === handle.spanId)
  if (!span) return { messages: null, replacedSummary: null }

  const summaries = span.summaryIds
    .map((sid) => conv.summaries.get(sid))
    .filter(Boolean) as SummaryNode[]

  let replacedSummary: SummaryNode | null = null
  if (summaries.length > 0) {
    replacedSummary = summaries[summaries.length - 1]
  }

  span.summaryIds = []

  return { messages: span.messages, replacedSummary }
}
