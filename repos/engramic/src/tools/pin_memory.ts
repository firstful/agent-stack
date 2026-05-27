import type { Conversation } from "../types.js"

export interface PinMemoryResult {
  success: boolean
  memoryId: string
  reason: string
  message: string
}

export function executePinMemory(
  conv: Conversation,
  memoryId: string,
  reason: string,
): PinMemoryResult {
  const handle = conv.memories.find((m) => m.id === memoryId)
  if (!handle) {
    return { success: false, memoryId, reason, message: `Memory handle not found: ${memoryId}` }
  }

  handle.pinned = true
  handle.pinReason = reason
  conv.updatedAt = Date.now()

  return { success: true, memoryId, reason, message: `Pinned memory ${memoryId}: ${reason}` }
}
