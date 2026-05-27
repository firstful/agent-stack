import type { Conversation, TranscriptSpan, SummaryNode, MemoryHandle, Message } from "../types.js"
import type { Provider } from "../provider/index.js"
import type { EmbeddingsProvider } from "../provider/embeddings.js"
import type { VectorStore } from "../memory/vector.js"

const TOKEN_THRESHOLD = 80_000
const TURN_THRESHOLD = 20
const IDLE_THRESHOLD_MS = 30_000

export function shouldCompress(conv: Conversation): boolean {
  const totalTokens = conv.spans.reduce((sum, s) => sum + s.tokenCount, 0)
  if (totalTokens > TOKEN_THRESHOLD) return true
  const totalMessages = conv.spans.reduce((sum, s) => sum + s.messages.length, 0)
  if (totalMessages > TURN_THRESHOLD) return true
  if (Date.now() - conv.updatedAt > IDLE_THRESHOLD_MS && totalTokens > 10_000) return true
  return false
}

function selectSpansForCompression(conv: Conversation): TranscriptSpan[] {
  const scored = conv.spans
    .filter((s) => !s.messages.some((m) => m.role === "system"))
    .map((span) => {
      const summaryCount = span.summaryIds.length
      const age = Date.now() - span.createdAt
      const messages = span.messages.length
      const score = messages * 10 + age / 1000 - summaryCount * 100
      return { span, score }
    })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, Math.floor(conv.spans.length / 2))).map((s) => s.span)
}

function buildSummaryPrompt(spans: TranscriptSpan[]): string {
  const transcript = spans
    .flatMap((s) => s.messages)
    .map((m) => `${m.role}: ${m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join(" ")}`)
    .join("\n")

  return `Summarize the following conversation, preserving key decisions, architectural conclusions, unresolved tasks, and important context. Be detailed enough that the summary can substitute for the original transcript.

${transcript}`
}

export async function compressConversation(
  conv: Conversation,
  provider: Provider,
  embeddings?: EmbeddingsProvider,
  vectorStore?: VectorStore,
): Promise<void> {
  if (!shouldCompress(conv)) return
  const targets = selectSpansForCompression(conv)
  if (targets.length === 0) return

  const summaryMsg: Message[] = [
    {
      id: `sys_${Date.now()}`,
      role: "system",
      content: [{ type: "text", text: "You are a conversation summarizer. Produce concise, information-dense summaries." }],
    },
    {
      id: `usr_${Date.now()}`,
      role: "user",
      content: [{ type: "text", text: buildSummaryPrompt(targets) }],
    },
  ]

  const response = await provider.chat({
    model: "gpt-4o-mini",
    messages: summaryMsg,
    max_tokens: 2000,
  })

  const summaryText = response.message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  const totalTokens = targets.reduce((sum, s) => sum + s.tokenCount, 0)
  const summaryTokens = Math.ceil(summaryText.length / 4)
  const compressionRatio = summaryTokens > 0 ? totalTokens / summaryTokens : 1

  const summaryNode: SummaryNode = {
    id: `sum_${Math.random().toString(36).slice(2, 9)}`,
    sourceSpanIds: targets.map((s) => s.id),
    summaryText,
    importanceScore: 0.5,
    compressionRatio,
    parentSummaryIds: [],
    childSummaryIds: [],
  }

  conv.summaries.set(summaryNode.id, summaryNode)

  for (const span of targets) {
    span.summaryIds.push(summaryNode.id)
  }

  const topicText = summaryText.split(".").slice(0, 2).join(". ").slice(0, 80)
  const handle: MemoryHandle = {
    id: `mem_${Math.random().toString(36).slice(2, 9)}`,
    topic: topicText,
    turnRange: `${conv.spans.indexOf(targets[0]) + 1}-${conv.spans.indexOf(targets[targets.length - 1]) + 1}`,
    spanId: targets[0].id,
  }

  conv.memories.push(handle)

  if (embeddings && vectorStore) {
    try {
      const embeddingId = `emb_mem_${handle.id}`
      await vectorStore.insert(embeddingId, summaryText, handle.id, "memory")
      handle.embeddingId = embeddingId
      const ranked = await vectorStore.rankByImportance()
      const self = ranked.find((m) => m.record.id === embeddingId)
      if (self) summaryNode.importanceScore = self.score
    } catch (err) {
      console.error("Embedding generation failed during compression:", err)
    }
  }

  conv.updatedAt = Date.now()
}
