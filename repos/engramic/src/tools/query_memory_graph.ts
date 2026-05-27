import type { Conversation, SummaryNode, MemoryEvent } from "../types.js"

export interface QueryMemoryGraphResult {
  memories: Array<{ id: string; topic: string; turnRange: string; pinned?: boolean }>
  summaries: SummaryNode[]
  events: MemoryEvent[]
  depth: number
}

export function executeQueryMemoryGraph(
  conv: Conversation,
  query: string,
  depth: number,
): QueryMemoryGraphResult {
  const q = query.toLowerCase()
  const matchedMemories = conv.memories.filter(
    (m) => m.topic.toLowerCase().includes(q) || m.turnRange.includes(q),
  )

  const visitedSummaryIds = new Set<string>()
  const summaries: SummaryNode[] = []
  const visitedSpans = new Set<string>()

  for (const mem of matchedMemories) {
    visitedSpans.add(mem.spanId)
  }

  let currentDepth = 0
  let currentSpanIds = new Set(visitedSpans)

  while (currentDepth < depth && currentSpanIds.size > 0) {
    const nextSpanIds = new Set<string>()
    for (const spanId of currentSpanIds) {
      const span = conv.spans.find((s) => s.id === spanId)
      if (!span) continue
      for (const sid of span.summaryIds) {
        if (!visitedSummaryIds.has(sid)) {
          const summary = conv.summaries.get(sid)
          if (summary) {
            summaries.push(summary)
            visitedSummaryIds.add(sid)
            for (const pid of summary.parentSummaryIds) nextSpanIds.add(pid)
            for (const cid of summary.childSummaryIds) nextSpanIds.add(cid)
          }
        }
      }
    }
    currentSpanIds = nextSpanIds
    currentDepth++
  }

  const relatedEvents = conv.events.filter(
    (e) =>
      matchedMemories.some((m) => m.topic.toLowerCase().includes(e.content.toLowerCase())) ||
      e.content.toLowerCase().includes(q),
  )

  return {
    memories: matchedMemories.map((m) => ({ id: m.id, topic: m.topic, turnRange: m.turnRange, pinned: m.pinned })),
    summaries,
    events: relatedEvents,
    depth,
  }
}
