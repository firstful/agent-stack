import { readFile, writeFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type {
  Conversation, TranscriptSpan, SummaryNode, MemoryHandle, MemoryEvent,
  MemoryPolicy, ToolCallRecord, SystemEvent, MemoryDagNode, DagSubtreeQuery, DagExpiryResult
} from "../types.js"
import { MemoryDag } from "./dag.js"

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
  listConversationIds(): Promise<string[]>
  // ── DAG-aware methods ──
  addDagNode(conv: Conversation, spanId: string, parentIds?: string[]): MemoryDagNode
  linkDagNodes(conv: Conversation, parentId: string, childId: string): boolean
  getDagSubtree(conv: Conversation, query: DagSubtreeQuery): { nodes: MemoryDagNode[]; spans: TranscriptSpan[]; summaries: SummaryNode[]; events: MemoryEvent[] }
  expireDagSubtree(conv: Conversation, nodeId: string): DagExpiryResult
  reviveDagSubtree(conv: Conversation, nodeId: string): string[]
}

export class MemoryStore implements IMemoryStore {
  private conversations = new Map<string, Conversation>()

  constructor() {
    mkdir(DATA_DIR, { recursive: true })
  }

  private convPath(id: string): string {
    return join(DATA_DIR, `${id}.json`)
  }

  // ── DAG helpers ──

  private getDag(conv: Conversation): MemoryDag {
    return new MemoryDag(conv.dag)
  }

  private setDag(conv: Conversation, dag: MemoryDag): void {
    conv.dag = new Map(dag.toJSON())
  }

  async loadConversation(id: string): Promise<Conversation | null> {
    const cached = this.conversations.get(id)
    if (cached) return cached
    const path = this.convPath(id)
    if (!existsSync(path)) return null
    const raw = await readFile(path, "utf-8")
    const data = JSON.parse(raw) as Record<string, unknown>
    const defaultPolicy: MemoryPolicy = {
      compressionStrategy: "auto",
      compressionRate: "medium",
      recencyBias: 0.7,
      retentionPriority: [],
    }
    // Restore DAG from serialized entries
    const dagEntries = (data.dagEntries || data.dag || []) as [string, MemoryDagNode][]
    const conv: Conversation = {
      id: data.id as string,
      spans: (data.spans || []) as TranscriptSpan[],
      summaries: new Map((data.summaries || []) as [string, SummaryNode][]),
      memories: (data.memories || []) as MemoryHandle[],
      events: (data.events || []) as MemoryEvent[],
      toolCalls: (data.toolCalls || []) as ToolCallRecord[],
      systemEvents: (data.systemEvents || []) as SystemEvent[],
      dag: new Map(dagEntries),
      policy: (data.policy || defaultPolicy) as MemoryPolicy,
      createdAt: (data.createdAt as number) || Date.now(),
      updatedAt: (data.updatedAt as number) || Date.now(),
      metadata: (data.metadata || {}) as Record<string, unknown>,
    }
    this.conversations.set(id, conv)
    return conv
    return conv
  }

  async saveConversation(conv: Conversation): Promise<void> {
    this.conversations.set(conv.id, conv)
    const data = {
      ...conv,
      summaries: Array.from(conv.summaries.entries()),
      dagEntries: Array.from(conv.dag.entries()),
      // Remove both dag keys to avoid duplication; dagEntries is canonical
      dag: undefined,
    }
    await writeFile(this.convPath(conv.id), JSON.stringify(data, null, 2))
  }

  async getOrCreateConversation(id: string, _userId?: string): Promise<Conversation> {
    const existing = this.conversations.get(id)
    if (existing) return existing
    const loaded = await this.loadConversation(id)
    if (loaded) return loaded
    const defaultPolicy: MemoryPolicy = {
      compressionStrategy: "auto",
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
      toolCalls: [],
      systemEvents: [],
      dag: new Map(),
      policy: defaultPolicy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    }
    this.conversations.set(id, conv)
    return conv
  }

  async listConversationIds(): Promise<string[]> {
    if (!existsSync(DATA_DIR)) return []
    const entries = await readdir(DATA_DIR)
    return entries.filter((e) => e.endsWith(".json")).map((e) => e.slice(0, -5))
  }

  addSpan(conv: Conversation, span: TranscriptSpan): void {
    conv.spans.push(span)
    conv.updatedAt = Date.now()
    // Auto-create DAG node for the new span
    const dag = this.getDag(conv)
    dag.addNode(span.id)
    this.setDag(conv, dag)
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

  // ── DAG-aware methods ──

  addDagNode(conv: Conversation, spanId: string, parentIds?: string[]): MemoryDagNode {
    const dag = this.getDag(conv)
    const node = dag.addNode(spanId, parentIds)
    this.setDag(conv, dag)
    conv.updatedAt = Date.now()
    return node
  }

  linkDagNodes(conv: Conversation, parentId: string, childId: string): boolean {
    const dag = this.getDag(conv)
    const ok = dag.link(parentId, childId)
    if (ok) {
      this.setDag(conv, dag)
      conv.updatedAt = Date.now()
    }
    return ok
  }

  getDagSubtree(
    conv: Conversation,
    query: DagSubtreeQuery,
  ): { nodes: MemoryDagNode[]; spans: TranscriptSpan[]; summaries: SummaryNode[]; events: MemoryEvent[] } {
    const dag = this.getDag(conv)
    return dag.querySubtree(conv, query)
  }

  expireDagSubtree(conv: Conversation, nodeId: string): DagExpiryResult {
    const dag = this.getDag(conv)
    const { nodeIds, spanIds } = dag.expireSubtree(nodeId)
    if (nodeIds.length > 0) {
      this.setDag(conv, dag)
      conv.updatedAt = Date.now()
    }
    return {
      expiredNodeIds: nodeIds,
      expiredSpanIds: spanIds,
      totalNodesAffected: nodeIds.length,
    }
  }

  reviveDagSubtree(conv: Conversation, nodeId: string): string[] {
    const dag = this.getDag(conv)
    const revived = dag.reviveSubtree(nodeId)
    if (revived.length > 0) {
      this.setDag(conv, dag)
      conv.updatedAt = Date.now()
    }
    return revived
  }

  // ── Legacy graph query (updated to use DAG traversal) ──

  getMemoryGraph(
    conv: Conversation,
    query: string,
    depth: number,
  ): { memories: MemoryHandle[]; summaries: SummaryNode[]; events: MemoryEvent[] } {
    const q = query.toLowerCase()

    // First find matching memories via text query
    const matchedMemories = conv.memories.filter(
      (m) => m.topic.toLowerCase().includes(q) || m.turnRange.includes(q),
    )

    // Then use the DAG to expand the search — find matching DAG nodes and walk their neighborhoods
    const dag = this.getDag(conv)

    // Collect root candidates: DAG nodes matching the memory span IDs
    const candidateNodeIds = new Set<string>()
    for (const mem of matchedMemories) {
      // Find the DAG node by span ID
      const dagNode = dag.getNodeBySpanId(mem.spanId)
      if (dagNode) {
        candidateNodeIds.add(dagNode.id)
      }
    }

    // Walk the DAG from each candidate to depth
    const visitedNodeIds = new Set<string>(candidateNodeIds)
    const visitedSummaryIds = new Set<string>()
    const summaries: SummaryNode[] = []
    const relatedSpanIds = new Set<string>()

    // Initial nodes
    for (const nid of candidateNodeIds) {
      const node = dag.getNode(nid)
      if (node) relatedSpanIds.add(node.spanId)
    }

    // BFS expansion
    let currentLayer = Array.from(candidateNodeIds)
    let currentDepth = 0

    while (currentDepth < depth && currentLayer.length > 0) {
      const nextLayer: string[] = []

      for (const nid of currentLayer) {
        const node = dag.getNode(nid)
        if (!node) continue

        // Walk parents
        for (const pid of node.parentIds) {
          if (!visitedNodeIds.has(pid)) {
            visitedNodeIds.add(pid)
            nextLayer.push(pid)
            const pnode = dag.getNode(pid)
            if (pnode) relatedSpanIds.add(pnode.spanId)
          }
        }

        // Walk children
        for (const cid of node.childIds) {
          if (!visitedNodeIds.has(cid)) {
            visitedNodeIds.add(cid)
            nextLayer.push(cid)
            const cnode = dag.getNode(cid)
            if (cnode) relatedSpanIds.add(cnode.spanId)
          }
        }
      }

      currentLayer = nextLayer
      currentDepth++
    }

    // Collect summaries from the related spans
    for (const spanId of relatedSpanIds) {
      const span = conv.spans.find((s) => s.id === spanId)
      if (!span) continue
      for (const sid of span.summaryIds) {
        if (!visitedSummaryIds.has(sid)) {
          visitedSummaryIds.add(sid)
          const summary = conv.summaries.get(sid)
          if (summary) summaries.push(summary)
        }
      }
    }

    // Also collect by walking summary parent/child links (legacy approach)
    // for backward compat with summaries not linked to DAG spans
    for (const summary of summaries) {
      const walkSummary = (s: SummaryNode, dir: "parent" | "child", remainingDepth: number) => {
        if (remainingDepth <= 0) return
        const ids = dir === "parent" ? s.parentSummaryIds : s.childSummaryIds
        for (const relId of ids) {
          if (!visitedSummaryIds.has(relId)) {
            visitedSummaryIds.add(relId)
            const rel = conv.summaries.get(relId)
            if (rel) {
              summaries.push(rel)
              walkSummary(rel, dir, remainingDepth - 1)
            }
          }
        }
      }
      walkSummary(summary, "parent", depth)
      walkSummary(summary, "child", depth)
    }

    // Collect related events
    const relatedEvents = conv.events.filter(
      (e) =>
        matchedMemories.some((m) => m.topic.toLowerCase().includes(e.content.toLowerCase())) ||
        e.content.toLowerCase().includes(q) ||
        (e.spanId && relatedSpanIds.has(e.spanId)),
    )

    return { memories: matchedMemories, summaries, events: relatedEvents }
  }
}
