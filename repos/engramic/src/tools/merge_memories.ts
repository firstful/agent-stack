import type { Conversation, MemoryHandle } from "../types.js"

export interface MergeMemoriesResult {
  merged: boolean
  mergedId: string
  mergedTopic: string
  removedIds: string[]
  message: string
}

export function executeMergeMemories(
  conv: Conversation,
  memoryIds: string[],
): MergeMemoriesResult {
  if (memoryIds.length < 2) {
    return {
      merged: false,
      mergedId: "",
      mergedTopic: "",
      removedIds: [],
      message: "At least two memory IDs are required to merge",
    }
  }

  const handles = memoryIds.map((id) => conv.memories.find((m) => m.id === id)).filter(Boolean) as MemoryHandle[]

  if (handles.length < 2) {
    return {
      merged: false,
      mergedId: "",
      mergedTopic: "",
      removedIds: [],
      message: "Could not find enough valid memory handles to merge",
    }
  }

  const mergedTopic = handles.map((h) => h.topic).join("; ")
  const spanIds = handles.map((h) => h.spanId)
  const range = `${handles[0].turnRange}-${handles[handles.length - 1].turnRange}`
  const pinned = handles.some((h) => h.pinned)

  const mergedId = `mem_merged_${Date.now()}`
  const mergedHandle: MemoryHandle = {
    id: mergedId,
    topic: mergedTopic,
    turnRange: range,
    spanId: spanIds[0],
    pinned,
    pinReason: pinned ? "Merged from pinned memories" : undefined,
  }

  const removedIds = handles.map((h) => h.id)
  conv.memories = conv.memories.filter((m) => !removedIds.includes(m.id))
  conv.memories.push(mergedHandle)
  conv.updatedAt = Date.now()

  return {
    merged: true,
    mergedId,
    mergedTopic,
    removedIds,
    message: `Merged ${handles.length} memories into ${mergedId}`,
  }
}
