import type { Conversation, TranscriptSpan, SummaryNode } from "../types.js"

export type FocusType = "topic" | "task" | "span_id"

export interface RebuildContextWindowResult {
  focusType: FocusType
  focusValue: string
  includedSpans: number
  excludedSummaries: number
  message: string
}

export function executeRebuildContextWindow(
  conv: Conversation,
  focus: FocusType,
  focusValue: string,
): RebuildContextWindowResult {
  let includedSpans: TranscriptSpan[] = []

  switch (focus) {
    case "span_id": {
      const span = conv.spans.find((s) => s.id === focusValue)
      if (span) includedSpans = [span]
      break
    }
    case "topic": {
      const q = focusValue.toLowerCase()
      const matchingMemories = conv.memories.filter(
        (m) => m.topic.toLowerCase().includes(q),
      )
      const spanIds = new Set(matchingMemories.map((m) => m.spanId))
      includedSpans = conv.spans.filter((s) => spanIds.has(s.id))
      if (includedSpans.length === 0) {
        includedSpans = conv.spans.slice(-5)
      }
      break
    }
    case "task": {
      const taskEvents = conv.events.filter(
        (e) => e.type === "task" && e.content.toLowerCase().includes(focusValue.toLowerCase()),
      )
      const candidateSpans: TranscriptSpan[] = []
      for (const event of taskEvents) {
        if (event.spanId) {
          const span = conv.spans.find((s) => s.id === event.spanId)
          if (span) candidateSpans.push(span)
        }
      }
      includedSpans = candidateSpans.length > 0 ? candidateSpans : conv.spans.slice(-5)
      break
    }
  }

  let excludedSummaries = 0
  const keptSpanIds = new Set(includedSpans.map((s) => s.id))

  for (const span of conv.spans) {
    if (!keptSpanIds.has(span.id)) {
      excludedSummaries += span.summaryIds.length
      span.summaryIds = []
    }
  }

  conv.memories = conv.memories.filter((m) => keptSpanIds.has(m.spanId))
  conv.updatedAt = Date.now()

  return {
    focusType: focus,
    focusValue,
    includedSpans: includedSpans.length,
    excludedSummaries,
    message: `Context window rebuilt: ${includedSpans.length} spans active (${focus}=${focusValue}), ${excludedSummaries} summary references cleared`,
  }
}
