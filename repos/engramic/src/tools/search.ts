import type { Conversation, MemoryHandle } from "../types.js"
import type { VectorStore } from "../memory/vector.js"

export interface SearchResult {
  matches: MemoryHandle[]
  semantic: boolean
}

export async function executeSearch(
  conv: Conversation,
  query: string,
  vectorStore?: VectorStore,
): Promise<SearchResult> {
  if (vectorStore && vectorStore.size() > 0) {
    const scored = await vectorStore.searchMemories(query, conv.memories, 5)
    if (scored.length > 0 && scored[0].score > 0) {
      return { matches: scored.map((s) => s.handle), semantic: true }
    }
  }

  const q = query.toLowerCase()
  const matches = conv.memories.filter((m) => {
    const topic = m.topic.toLowerCase()
    const range = m.turnRange.toLowerCase()
    return topic.includes(q) || range.includes(q)
  })

  return { matches, semantic: false }
}
