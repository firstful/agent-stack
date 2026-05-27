import type { ProviderStreamEvent } from "../types.js"

export interface BufferedStream {
  events: ProviderStreamEvent[]
  finished: boolean
}

export function createStreamBuffer(): BufferedStream {
  return { events: [], finished: false }
}

export function appendToBuffer(buffer: BufferedStream, event: ProviderStreamEvent): void {
  buffer.events.push(event)
  if (event.type === "done") {
    buffer.finished = true
  }
}

export function flushBuffer(buffer: BufferedStream): ProviderStreamEvent[] {
  const events = [...buffer.events]
  buffer.events = []
  return events
}

export function* replayBuffer(events: ProviderStreamEvent[]): Generator<string> {
  for (const event of events) {
    if (event.type === "chunk") {
      yield `data: {"choices":[{"delta":{"content":${JSON.stringify(event.data)}}}]}\n\n`
    } else if (event.type === "done") {
      yield "data: [DONE]\n\n"
    } else if (event.type === "tool_call") {
      // tool calls are suppressed from the client stream
    }
  }
}

export function serializeNonStreamResponse(
  id: string,
  model: string,
  content: string,
): string {
  return JSON.stringify({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  })
}

export function serializeStreamChunk(id: string, model: string, content: string): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`
}

export function serializeStreamDone(): string {
  return "data: [DONE]\n\n"
}
