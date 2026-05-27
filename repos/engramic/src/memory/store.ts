import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Conversation, TranscriptSpan, SummaryNode, MemoryHandle, MemoryEvent, MemoryPolicy } from "../types.js"

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"

export interface IMemoryStore {
  getOrCreateConversation(id: string, userId?: string): Promise<Conversation>
  saveConversation(conv: Conversation): Promise<void>
  addSpan(conv: Conversation, span: TranscriptSpan): void
  addSummary(conv: Conversation, summary: SummaryNode): void
  addMemory(conv: Conversation, handle: MemoryHandle): void
  getSpan(conv: Conversation, spanId: string): TranscriptSpan | undefined
  getSummary(conv: Conversation, summaryId: string): SummaryNode | undefined
  getMemories(conv: Conversation): MemoryHandle[]
  pinMemory(conv: Conversation, memoryId: string, reason: string): boolean
  unpinMemory(conv: Conversation, memoryId: string): boolean
  markEvent(conv: Conversation, event: MemoryEvent): void
  setPolicy(conv: Conversation, policy: Partial<MemoryPolicy>): MemoryPolicy
  getMemoryGraph(conv: Conversation, query: string, depth: number): { memories: MemoryHandle[]; summaries: SummaryNode[]; events: MemoryEvent[] }
}

export class MemoryStore implements IMemoryStore {
  private conversations = new Map<string, Conversation>()

  constructor() {
    mkdir(DATA_DIR, { recursive: true })
  }

  private convPath(id: string): string {
    return join(DATA_DIR, `${id}.json`)
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const cached = this.conversations.get(id)
    if (cached) return cached
    const path = this.convPath(id)
    if (!existsSync(path)) return null
    const raw = await readFile(path, "utf-8")
    const data = JSON.parse(raw) as Record<string, unknown>
    const defaultPolicy: MemoryPolicy = {
      compressionRate: "medium",
      recencyBias: 0.7,
      retentionPriority: [],
    }
    const conv: Conversation = {
      id: data.id as string,
      spans: (data.spans || []) as TranscriptSpan[],
      summaries: new Map((data.summaries || []) as [string, SummaryNode][]),
      memories: (data.memories || []) as MemoryHandle[],
      events: (data.events || []) as MemoryEvent[],
      policy: (data.policy || defaultPolicy) as MemoryPolicy,
      createdAt: (data.createdAt as number) || Date.now(),
      updatedAt: (data.updatedAt as number) || Date.now(),
      metadata: (data.metadata || {}) as Record<string, unknown>,
    }
    this.conversations.set(id, conv)
    return conv
  }

  async saveConversation(conv: Conversation): Promise<void> {
    this.conversations.set(conv.id, conv)
    const data = {
      ...conv,
      summaries: Array.from(conv.summaries.entries()),
    }
    await writeFile(this.convPath(conv.id), JSON.stringify(data, null, 2))
  }

  async getOrCreateConversation(id: string, _userId?: string): Promise<Conversation> {
    const existing = this.conversations.get(id)
    if (existing) return existing
    const loaded = await this.loadConversation(id)
    if (loaded) return loaded
    const defaultPolicy: MemoryPolicy = {
      compressionRate: "medium",
      recencyBias: 0.7,
      retentionPriority: [],
    }
    const conv: Conversation = {
      id,
      spans: [],
      summaries: new Map(),
      memories: [],
      events: [],
      policy: defaultPolicy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    }
    this.conversations.set(id, conv)
    return conv
  }

  addSpan(conv: Conversation, span: TranscriptSpan): void {
    conv.spans.push(span)
    conv.updatedAt = Date.now()
  }

  addSummary(conv: Conversation, summary: SummaryNode): void {
    conv.summaries.set(summary.id, summary)
  }

  addMemory(conv: Conversation, handle: MemoryHandle): void {
    conv.memories.push(handle)
  }

  getSpan(conv: Conversation, spanId: string): TranscriptSpan | undefined {
    return conv.spans.find((s) => s.id === spanId)
  }

  getSummary(conv: Conversation, summaryId: string): SummaryNode | undefined {
    return conv.summaries.get(summaryId)
  }

  getMemories(conv: Conversation): MemoryHandle[] {
    return conv.memories
  }

  pinMemory(conv: Conversation, memoryId: string, reason: string): boolean {
    const handle = conv.memories.find((m) => m.id === memoryId)
    if (!handle) return false
    handle.pinned = true
    handle.pinReason = reason
    conv.updatedAt = Date.now()
    return true
  }

  unpinMemory(conv: Conversation, memoryId: string): boolean {
    const handle = conv.memories.find((m) => m.id === memoryId)
    if (!handle) return false
    handle.pinned = false
    handle.pinReason = undefined
    conv.updatedAt = Date.now()
    return true
  }

  markEvent(conv: Conversation, event: MemoryEvent): void {
    conv.events.push(event)
    conv.updatedAt = Date.now()
  }

  setPolicy(conv: Conversation, policy: Partial<MemoryPolicy>): MemoryPolicy {
    conv.policy = { ...conv.policy, ...policy }
    conv.updatedAt = Date.now()
    return conv.policy
  }

  getMemoryGraph(conv: Conversation, query: string, depth: number): { memories: MemoryHandle[]; summaries: SummaryNode[]; events: MemoryEvent[] } {
    const q = query.toLowerCase()
    const matchedMemories = conv.memories.filter(
      (m) => m.topic.toLowerCase().includes(q) || m.turnRange.includes(q),
    )

    const visitedSummaryIds = new Set<string>()
    const summaries: SummaryNode[] = []
    const visitedSpans = new Set<string>()

    for (const mem of matchedMemories) {
      visitedSpans.add(mem.spanId)
    }

    let currentDepth = 0
    let currentSpanIds = new Set(visitedSpans)

    while (currentDepth < depth && currentSpanIds.size > 0) {
      const nextSpanIds = new Set<string>()

      for (const spanId of currentSpanIds) {
        const span = conv.spans.find((s) => s.id === spanId)
        if (!span) continue
        for (const sid of span.summaryIds) {
          if (!visitedSummaryIds.has(sid)) {
            const summary = conv.summaries.get(sid)
            if (summary) {
              summaries.push(summary)
              visitedSummaryIds.add(sid)
              for (const pid of summary.parentSummaryIds) nextSpanIds.add(pid)
              for (const cid of summary.childSummaryIds) nextSpanIds.add(cid)
            }
          }
        }
      }

      currentSpanIds = nextSpanIds
      currentDepth++
    }

    const relatedEvents = conv.events.filter(
      (e) => matchedMemories.some((m) => m.topic.toLowerCase().includes(e.content.toLowerCase())) || e.content.toLowerCase().includes(q),
    )

    return { memories: matchedMemories, summaries, events: relatedEvents }
  }
}
