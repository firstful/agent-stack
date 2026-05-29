import type { Conversation, Message, SummaryNode, MemoryHandle } from "../types.js"
import type { IUserStore } from "../auth/user-store.js"

export interface RememberResult {
  messages: Message[] | null
  replacedSummary: SummaryNode | null
}

export async function executeRemember(
  conv: Conversation,
  memoryId: string,
  userStore?: IUserStore,
  userId?: string,
): Promise<RememberResult> {
  let handle = conv.memories.find((m) => m.id === memoryId)

  // Fall back to global account memories if not found locally
  if (!handle && userStore && userId) {
    const globalMemories = await userStore.getAccountMemories(userId)
    const globalHandle = globalMemories.find((m) => m.id === memoryId)
    if (globalHandle) {
      // Copy into current conversation for future local access
      const copied: MemoryHandle = { ...globalHandle, id: `${globalHandle.id}_local_${Date.now()}` }
      conv.memories.push(copied)
      handle = copied
    }
  }

  if (!handle) return { messages: null, replacedSummary: null }

  const span = conv.spans.find((s) => s.id === handle.spanId)
  if (!span) {
    // Global memory from another conversation — we don't have the span.
    // Return a synthetic message summarizing the memory topic.
    const synthetic: Message = {
      id: `mem_${Date.now()}`,
      role: "system",
      content: [{ type: "text", text: `[Cross-session memory recalled: ${handle.topic}]` }],
    }
    return { messages: [synthetic], replacedSummary: null }
  }

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
