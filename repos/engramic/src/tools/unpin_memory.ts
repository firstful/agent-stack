import type { Conversation } from "../types.js"

export interface UnpinMemoryResult {
  success: boolean
  memoryId: string
  message: string
}

export function executeUnpinMemory(
  conv: Conversation,
  memoryId: string,
): UnpinMemoryResult {
  const handle = conv.memories.find((m) => m.id === memoryId)
  if (!handle) {
    return { success: false, memoryId, message: `Memory handle not found: ${memoryId}` }
  }

  if (!handle.pinned) {
    return { success: true, memoryId, message: `Memory ${memoryId} was not pinned` }
  }

  handle.pinned = false
  handle.pinReason = undefined
  conv.updatedAt = Date.now()

  return { success: true, memoryId, message: `Unpinned memory ${memoryId}` }
}
