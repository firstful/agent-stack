import type { Conversation, MemoryEvent } from "../types.js"

export type EventType = "decision" | "fact" | "task" | "correction"

export interface MarkEventResult {
  event: MemoryEvent
  message: string
}

export function executeMarkEvent(
  conv: Conversation,
  type: EventType,
  content: string,
): MarkEventResult {
  const validTypes: EventType[] = ["decision", "fact", "task", "correction"]
  const normalizedType = validTypes.includes(type) ? type : "fact"

  const event: MemoryEvent = {
    id: `evt_${Math.random().toString(36).slice(2, 9)}`,
    type: normalizedType,
    content,
    timestamp: Date.now(),
    spanId: conv.spans.length > 0 ? conv.spans[conv.spans.length - 1].id : undefined,
  }

  conv.events.push(event)
  conv.updatedAt = Date.now()

  return {
    event,
    message: `Event recorded: [${normalizedType}] ${content}`,
  }
}
