import type { ProviderCapabilities, ProviderRequest, ProviderResponse, ProviderStreamEvent } from "../types.js"

export interface Provider {
  readonly name: string
  readonly capabilities: ProviderCapabilities

  chat(request: ProviderRequest): Promise<ProviderResponse>
  chatStream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(messages: ProviderRequest["messages"]): number {
  let total = 0
  for (const m of messages) {
    total += 4
    for (const part of m.content) {
      if (part.type === "text") {
        total += estimateTokens(part.text)
      }
    }
  }
  return total
}
