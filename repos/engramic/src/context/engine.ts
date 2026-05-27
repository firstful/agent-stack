import type { Conversation, Message, TokenBudget, TranscriptSpan, SummaryNode, MemoryHandle, BudgetStrategy } from "../types.js"
import { estimateMessagesTokens } from "../provider/index.js"

const DEFAULT_MAX_TOKENS = 128_000
const DEFAULT_SYSTEM_RESERVE = 1000
const DEFAULT_WORKING_SET_RESERVE = 4000

export function createBudget(maxTokens = DEFAULT_MAX_TOKENS): TokenBudget {
  return {
    maxTokens,
    systemReserve: DEFAULT_SYSTEM_RESERVE,
    workingSetReserve: DEFAULT_WORKING_SET_RESERVE,
    summaryReserve: Math.floor(maxTokens * 0.3),
    currentUsage: 0,
  }
}

export interface AssembledContext {
  systemMessages: Message[]
  workingMessages: Message[]
  summaryNodes: SummaryNode[]
  archivedSpans: TranscriptSpan[]
  budget: TokenBudget
}

export class ContextEngine {
  assemble(
    conv: Conversation,
    incomingMessages: Message[],
    budget: TokenBudget,
  ): AssembledContext {
    const systemMessages = incomingMessages.filter((m) => m.role === "system")
    const userMessages = incomingMessages.filter((m) => m.role !== "system")

    const systemTokens = estimateMessagesTokens(systemMessages)
    const userTokens = estimateMessagesTokens(userMessages)

    let available = budget.maxTokens - systemTokens - userTokens - budget.systemReserve - budget.workingSetReserve

    const workingMessages: Message[] = []
    const summaryNodes: SummaryNode[] = []
    const archivedSpans: TranscriptSpan[] = []

    const strategy = (conv.metadata?.budgetStrategy as BudgetStrategy) || "balanced"
    const sortedSpans = this.sortByStrategy(conv.spans, strategy)

    for (const span of sortedSpans) {
      if (span.messages.some((m) => m.role === "system")) {
        workingMessages.unshift(...span.messages)
        available -= estimateMessagesTokens(span.messages)
        continue
      }

      const spanTokens = estimateMessagesTokens(span.messages)
      if (spanTokens <= available) {
        workingMessages.unshift(...span.messages)
        available -= spanTokens
      } else {
        const summaries = span.summaryIds.map((sid) => conv.summaries.get(sid)).filter(Boolean) as SummaryNode[]
        const sortedSummaries = summaries.sort((a, b) => b.importanceScore - a.importanceScore)
        let summaryAdded = false
        for (const summary of sortedSummaries) {
          const summaryTokens = estimateTokenCount(summary)
          if (summaryTokens <= available) {
            summaryNodes.push(summary)
            available -= summaryTokens
            summaryAdded = true
            break
          }
        }
        if (!summaryAdded) {
          archivedSpans.push(span)
        }
      }
    }

    workingMessages.push(...userMessages)

    budget.currentUsage = budget.maxTokens - available

    return {
      systemMessages,
      workingMessages,
      summaryNodes,
      archivedSpans,
      budget,
    }
  }

  private sortByStrategy(spans: TranscriptSpan[], strategy: BudgetStrategy): TranscriptSpan[] {
    switch (strategy) {
      case "expand_recent":
        return [...spans].sort((a, b) => b.createdAt - a.createdAt)
      case "preserve_old":
        return [...spans].sort((a, b) => a.createdAt - b.createdAt)
      case "task_focus": {
        const pinned = spans.filter((s) => s.messages.some((m) => m.metadata?.pinned))
        const rest = spans.filter((s) => !pinned.includes(s))
        return [...pinned, ...rest.sort((a, b) => b.createdAt - a.createdAt)]
      }
      case "balanced":
      default:
        return [...spans]
    }
  }

  expandMemory(conv: Conversation, memoryId: string): Message[] | null {
    const handle = conv.memories.find((m) => m.id === memoryId)
    if (!handle) return null
    const span = conv.spans.find((s) => s.id === handle.spanId)
    if (!span) return null
    return span.messages
  }

  searchMemory(conv: Conversation, query: string): MemoryHandle[] {
    const q = query.toLowerCase()
    return conv.memories.filter(
      (m) =>
        m.topic.toLowerCase().includes(q) || m.turnRange.includes(q),
    )
  }
}

function estimateTokenCount(summary: SummaryNode): number {
  return Math.ceil(summary.summaryText.length / 4) + 50
}
