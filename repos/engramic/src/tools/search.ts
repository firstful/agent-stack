import type { Conversation, MemoryHandle } from "../types.js"
import type { IVectorStore } from "../memory/vector.js"
import type { IUserStore } from "../auth/user-store.js"

export interface SearchResult {
  matches: MemoryHandle[]
  semantic: boolean
}

export async function executeSearch(
  conv: Conversation,
  query: string,
  vectorStore?: IVectorStore,
  userStore?: IUserStore,
  userId?: string,
): Promise<SearchResult> {
  if (vectorStore && (await vectorStore.size()) > 0) {
    const scored = await vectorStore.searchMemories(query, conv.memories, 5)
    if (scored.length > 0 && scored[0].score > 0) {
      return { matches: scored.map((s) => s.handle), semantic: true }
    }
  }

  const q = query.toLowerCase()
  let matches = conv.memories.filter((m) => {
    const topic = m.topic.toLowerCase()
    const range = m.turnRange.toLowerCase()
    return topic.includes(q) || range.includes(q)
  })

  // Fall back to global account memories if no local matches
  if (matches.length === 0 && userStore && userId) {
    const globalMemories = await userStore.getAccountMemories(userId)
    matches = globalMemories.filter((m) => {
      const topic = m.topic.toLowerCase()
      const range = m.turnRange.toLowerCase()
      return topic.includes(q) || range.includes(q)
    })
  }

  return { matches, semantic: false }
}
