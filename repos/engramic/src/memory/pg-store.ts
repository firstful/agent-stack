import { Pool } from "pg"
import type { Conversation, TranscriptSpan, SummaryNode, MemoryHandle, MemoryEvent, MemoryPolicy } from "../types.js"

export class PgMemoryStore {
  private pool: Pool
  private conversations = new Map<string, Conversation>()

  constructor(pool?: Pool) {
    this.pool = pool || new Pool({ connectionString: process.env.ENGRA_DATABASE_URL })
  }

  private async loadConversation(id: string): Promise<Conversation | null> {
    const cached = this.conversations.get(id)
    if (cached) return cached
    const r = await this.pool.query("SELECT data, created_at, updated_at FROM conversations WHERE id = $1", [id])
    if (!r.rows.length) return null
    const row = r.rows[0]
    const raw = row.data
    const defaultPolicy: MemoryPolicy = {
      compressionRate: "medium",
      recencyBias: 0.7,
      retentionPriority: [],
    }
    const conv: Conversation = {
      id,
      spans: (raw.spans || []) as TranscriptSpan[],
      summaries: new Map((raw.summaries || []) as [string, SummaryNode][]),
      memories: (raw.memories || []) as MemoryHandle[],
      events: (raw.events || []) as MemoryEvent[],
      policy: (raw.policy || defaultPolicy) as MemoryPolicy,
      createdAt: (raw.createdAt as number) || Date.now(),
      updatedAt: (raw.updatedAt as number) || Date.now(),
      metadata: (raw.metadata || {}) as Record<string, unknown>,
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
    const userId = (conv.metadata?.user_id as string) || "unknown"
    await this.pool.query(
      `INSERT INTO conversations (id, user_id, data, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO UPDATE SET user_id = $2, data = $3::jsonb, updated_at = $5`,
      [conv.id, userId, JSON.stringify(data), conv.createdAt, Date.now()],
    )
  }

  async getOrCreateConversation(id: string, userId?: string): Promise<Conversation> {
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
      metadata: { user_id: userId || "" },
    }
    this.conversations.set(id, conv)
    await this.saveConversation(conv)
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
