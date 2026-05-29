import type { Conversation, Message, SummaryNode, MemoryHandle, TranscriptSpan } from "../types.js"
import type { Provider } from "../provider/index.js"

export type CompressionLevel = "light" | "medium" | "aggressive"

export interface CompressMemoryResult {
  spanIds: string[]
  level: CompressionLevel
  summaryId: string | null
  message: string
}

function buildPrompt(spans: TranscriptSpan[]): string {
  const transcript = spans
    .flatMap((s) => s.messages)
    .map((m) => `${m.role}: ${m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join(" ")}`)
    .join("\n")

  return `Summarize the following conversation spans, preserving key decisions, architectural conclusions, unresolved tasks, and important context. Be detailed enough that the summary can substitute for the original transcript.

${transcript}`
}

export async function executeCompressMemory(
  conv: Conversation,
  scopeId: string,
  level: CompressionLevel,
  summarizationProvider?: Provider,
  summarizationModel?: string,
): Promise<CompressMemoryResult> {
  const targetSpans = conv.spans.filter((s) => s.id === scopeId || scopeId === "all")

  if (targetSpans.length === 0) {
    return { spanIds: [], level, summaryId: null, message: `No spans found for scope: ${scopeId}` }
  }

  const spanIds = targetSpans.map((s) => s.id)

  if (!summarizationProvider) {
    return { spanIds, level, summaryId: null, message: `No summarization provider configured; compression scheduled for ${targetSpans.length} span(s) at ${level} level.` }
  }

  const systemMsg: Message = {
    id: `sys_${Date.now()}`,
    role: "system",
    content: [{ type: "text", text: `You are a conversation summarizer. Use ${level} compression level. Be concise but preserve all key details.` }],
  }

  const userMsg: Message = {
    id: `usr_${Date.now()}`,
    role: "user",
    content: [{ type: "text", text: buildPrompt(targetSpans) }],
  }

  const response = await summarizationProvider.chat({
    model: summarizationModel || "gpt-4o-mini",
    messages: [systemMsg, userMsg],
    max_tokens: 2000,
  })

  const summaryText = response.message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  const totalTokens = targetSpans.reduce((sum, s) => sum + s.tokenCount, 0)
  const summaryTokens = Math.ceil(summaryText.length / 4)
  const compressionRatio = summaryTokens > 0 ? totalTokens / summaryTokens : 1

  const existingParentIds = [...new Set(targetSpans.flatMap((s) => s.summaryIds))]
  const parentSummaryIds = existingParentIds.filter((id) => conv.summaries.has(id))

  const summaryNode: SummaryNode = {
    id: `sum_${Math.random().toString(36).slice(2, 9)}`,
    sourceSpanIds: spanIds,
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

  for (const span of targetSpans) {
    span.summaryIds.push(summaryNode.id)
  }

  const topicText = summaryText.split(".").slice(0, 2).join(". ").slice(0, 80)
  const handle: MemoryHandle = {
    id: `mem_${Math.random().toString(36).slice(2, 9)}`,
    topic: topicText,
    turnRange: `${conv.spans.indexOf(targetSpans[0]) + 1}-${conv.spans.indexOf(targetSpans[targetSpans.length - 1]) + 1}`,
    spanId: targetSpans[0].id,
  }

  conv.memories.push(handle)
  conv.updatedAt = Date.now()

  return { spanIds, level, summaryId: summaryNode.id, message: `Compressed ${targetSpans.length} span(s) at ${level} level (ratio: ${compressionRatio.toFixed(1)}x). Summary: ${summaryText.slice(0, 120)}...` }
}
