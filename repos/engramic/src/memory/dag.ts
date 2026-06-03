import type { MemoryDagNode, DagSubtreeQuery, DagExpiryResult, TranscriptSpan, SummaryNode, MemoryEvent, Conversation } from "../types.js"

// ── DAG Engine ──────────────────────────────────────────────────────────────

export class MemoryDag {
  private nodes: Map<string, MemoryDagNode>

  constructor(nodes?: Map<string, MemoryDagNode>) {
    this.nodes = nodes ?? new Map<string, MemoryDagNode>()
  }

  // ── Node lifecycle ──

  /** Add a new DAG node linked to a transcript span, optionally with parent links */
  addNode(spanId: string, parentIds?: string[]): MemoryDagNode {
    const id = `dag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const node: MemoryDagNode = {
      id,
      spanId,
      parentIds: [],
      childIds: [],
      expiredAt: null,
      depth: 0,
      createdAt: Date.now(),
    }

    this.nodes.set(id, node)

    // Wire parents
    if (parentIds) {
      for (const pid of parentIds) {
        this.link(pid, id)
      }
    }

    // If no parents, depth stays 0. Otherwise we compute from parents.
    if (!parentIds || parentIds.length === 0) {
      this.recomputeDepth(id)
    }

    return node
  }

  /** Create a bidirected parent→child edge */
  link(parentId: string, childId: string): boolean {
    const parent = this.nodes.get(parentId)
    const child = this.nodes.get(childId)
    if (!parent || !child) return false

    // Prevent duplicate edges
    if (!parent.childIds.includes(childId)) {
      parent.childIds.push(childId)
    }
    if (!child.parentIds.includes(parentId)) {
      child.parentIds.push(parentId)
    }

    this.recomputeDepth(childId)
    // Recompute depths of all children transitively
    const descendants = this.getDescendants(childId)
    for (const desc of descendants) {
      this.recomputeDepth(desc.id)
    }

    return true
  }

  /** Remove the edge between parent and child (does not delete nodes) */
  unlink(parentId: string, childId: string): boolean {
    const parent = this.nodes.get(parentId)
    const child = this.nodes.get(childId)
    if (!parent || !child) return false

    parent.childIds = parent.childIds.filter((id) => id !== childId)
    child.parentIds = child.parentIds.filter((id) => id !== parentId)

    this.recomputeDepth(childId)
    return true
  }

  /** Remove a DAG node and all edges to/from it. Does NOT remove descendant nodes. */
  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    // Disconnect from parents
    for (const pid of node.parentIds) {
      const parent = this.nodes.get(pid)
      if (parent) {
        parent.childIds = parent.childIds.filter((id) => id !== nodeId)
      }
    }
    // Disconnect from children
    for (const cid of node.childIds) {
      const child = this.nodes.get(cid)
      if (child) {
        child.parentIds = child.parentIds.filter((id) => id !== nodeId)
      }
    }

    this.nodes.delete(nodeId)
    return true
  }

  // ── Traversal ──

  /** Get the subtree rooted at `nodeId` as a flattened array */
  getSubtree(nodeId: string, options?: { maxDepth?: number; includeExpired?: boolean }): MemoryDagNode[] {
    const opts = { maxDepth: Infinity, includeExpired: false, ...options }
    const root = this.nodes.get(nodeId)
    if (!root) return []
    if (!opts.includeExpired && root.expiredAt !== null) return []

    const result: MemoryDagNode[] = [root]
    this._collectDescendants(nodeId, opts, result, 0)
    return result
  }

  /** Get all descendant nodes down to `maxDepth` */
  getDescendants(nodeId: string, options?: { maxDepth?: number; includeExpired?: boolean }): MemoryDagNode[] {
    const opts = { maxDepth: Infinity, includeExpired: false, ...options }
    const root = this.nodes.get(nodeId)
    if (!root) return []

    const result: MemoryDagNode[] = []
    this._collectDescendants(nodeId, opts, result, 0)
    return result
  }

  /** Get all ancestor nodes up to `maxDepth` above */
  getAncestors(nodeId: string, options?: { maxDepth?: number; includeExpired?: boolean }): MemoryDagNode[] {
    const opts = { maxDepth: Infinity, includeExpired: false, ...options }
    const node = this.nodes.get(nodeId)
    if (!node) return []

    const visited = new Set<string>()
    const result: MemoryDagNode[] = []
    this._collectAncestors(nodeId, opts, result, visited, 0)
    return result
  }

  private _collectDescendants(
    nodeId: string,
    opts: { maxDepth: number; includeExpired: boolean },
    result: MemoryDagNode[],
    currentDepth: number,
  ): void {
    if (currentDepth >= opts.maxDepth) return
    const node = this.nodes.get(nodeId)
    if (!node) return

    for (const cid of node.childIds) {
      const child = this.nodes.get(cid)
      if (!child) continue
      if (!opts.includeExpired && child.expiredAt !== null) continue
      result.push(child)
      this._collectDescendants(cid, opts, result, currentDepth + 1)
    }
  }

  private _collectAncestors(
    nodeId: string,
    opts: { maxDepth: number; includeExpired: boolean },
    result: MemoryDagNode[],
    visited: Set<string>,
    currentDepth: number,
  ): void {
    if (currentDepth >= opts.maxDepth) return
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = this.nodes.get(nodeId)
    if (!node) return

    for (const pid of node.parentIds) {
      const parent = this.nodes.get(pid)
      if (!parent) continue
      if (!opts.includeExpired && parent.expiredAt !== null) continue
      result.push(parent)
      this._collectAncestors(pid, opts, result, visited, currentDepth + 1)
    }
  }

  // ── Subtree expiry ──

  /**
   * Expire a subtree: mark the root node and ALL descendants (including leaf)
   * as expired. Returns the count and IDs of affected nodes/spans.
   */
  expireSubtree(nodeId: string): { nodeIds: string[]; spanIds: string[] } {
    const root = this.nodes.get(nodeId)
    if (!root) return { nodeIds: [], spanIds: [] }

    const allNodes = this.getSubtree(nodeId, { includeExpired: true })
    const now = Date.now()

    const nodeIds: string[] = []
    const spanIds: string[] = []

    for (const dagNode of allNodes) {
      if (dagNode.expiredAt === null) {
        dagNode.expiredAt = now
      }
      nodeIds.push(dagNode.id)
      spanIds.push(dagNode.spanId)
    }

    return { nodeIds, spanIds }
  }

  /**
   * Revive an expired subtree (unmark all nodes in it)
   */
  reviveSubtree(nodeId: string): string[] {
    const root = this.nodes.get(nodeId)
    if (!root) return []

    const allNodes = this.getSubtree(nodeId, { includeExpired: true })
    const revived: string[] = []

    for (const dagNode of allNodes) {
      if (dagNode.expiredAt !== null) {
        dagNode.expiredAt = null
        revived.push(dagNode.id)
      }
    }

    return revived
  }

  // ── Queries ──

  /**
   * Query the DAG with a structured query object.
   * Returns matched DAG nodes along with expanded span/summary/event data.
   */
  querySubtree(
    conv: Conversation,
    query: DagSubtreeQuery,
  ): { nodes: MemoryDagNode[]; spans: TranscriptSpan[]; summaries: SummaryNode[]; events: MemoryEvent[] } {
    const subtree = this.getSubtree(query.rootNodeId, {
      maxDepth: query.maxDepth,
      includeExpired: query.includeExpired,
    })

    let matchedNodes = subtree

    // Apply text query filter if provided
    if (query.query) {
      const q = query.query.toLowerCase()
      matchedNodes = matchedNodes.filter((dagNode) => {
        const span = conv.spans.find((s) => s.id === dagNode.spanId)
        if (!span) return false
        const text = span.messages
          .map((m) => m.content.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join(" "))
          .join("\n")
          .toLowerCase()
        return text.includes(q) || dagNode.id.includes(q) || dagNode.spanId.includes(q)
      })
    }

    // Collect associated spans, summaries, events
    const spans: TranscriptSpan[] = []
    const summaryIds = new Set<string>()
    const eventRange = new Set<string>()

    for (const dagNode of matchedNodes) {
      const span = conv.spans.find((s) => s.id === dagNode.spanId)
      if (span) {
        spans.push(span)
        for (const sid of span.summaryIds) summaryIds.add(sid)
        // Collect span-level events
        for (const evt of conv.events) {
          if (evt.spanId === dagNode.spanId) eventRange.add(evt.id)
        }
      }
    }

    const summaries: SummaryNode[] = []
    for (const sid of summaryIds) {
      const s = conv.summaries.get(sid)
      if (s) summaries.push(s)
    }

    const events = conv.events.filter((e) => eventRange.has(e.id))

    return { nodes: matchedNodes, spans, summaries, events }
  }

  // ── Utilities ──

  getNode(nodeId: string): MemoryDagNode | undefined {
    return this.nodes.get(nodeId)
  }

  getNodeBySpanId(spanId: string): MemoryDagNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.spanId === spanId) return node
    }
    return undefined
  }

  getAllNodes(): MemoryDagNode[] {
    return Array.from(this.nodes.values())
  }

  getRoots(): MemoryDagNode[] {
    return this.getAllNodes().filter((n) => n.parentIds.length === 0)
  }

  getLeaves(): MemoryDagNode[] {
    return this.getAllNodes().filter((n) => n.childIds.length === 0)
  }

  getExpiredNodes(): MemoryDagNode[] {
    return this.getAllNodes().filter((n) => n.expiredAt !== null)
  }

  size(): number {
    return this.nodes.size
  }

  /** Recompute the depth of a single node as max(parent.depth) + 1 */
  recomputeDepth(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (!node) return

    if (node.parentIds.length === 0) {
      node.depth = 0
    } else {
      let maxParentDepth = -1
      for (const pid of node.parentIds) {
        const parent = this.nodes.get(pid)
        if (parent && parent.depth !== undefined) {
          maxParentDepth = Math.max(maxParentDepth, parent.depth)
        }
      }
      node.depth = maxParentDepth + 1
    }
  }

  /** Recompute depths for all nodes (topological walk from roots) */
  recomputeDepths(): void {
    const queue = this.getRoots().map((r) => r.id)
    const visited = new Set<string>()

    // BFS from roots
    let head = 0
    while (head < queue.length) {
      const currentId = queue[head++]
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const current = this.nodes.get(currentId)
      if (!current) continue

      // Depth already set by recomputeDepth; just enqueue children
      for (const cid of current.childIds) {
        if (!visited.has(cid)) {
          this.recomputeDepth(cid)
          queue.push(cid)
        }
      }
    }
  }

  /** Serialize the DAG for storage (Map → array of entries) */
  toJSON(): [string, MemoryDagNode][] {
    return Array.from(this.nodes.entries())
  }

  /** Deserialize the DAG from stored data */
  static fromJSON(entries: [string, MemoryDagNode][]): MemoryDag {
    return new MemoryDag(new Map(entries))
  }

  /** Build initial DAG from a flat span list, creating a root node for each span */
  static fromSpans(spans: TranscriptSpan[]): MemoryDag {
    const dag = new MemoryDag()
    for (const span of spans) {
      dag.addNode(span.id)
    }
    return dag
  }
}

// ── Standalone query helpers (for use without a MemoryDag instance) ──

/**
 * Filter a subtree from a flat DAG node list (e.g., from serialized data).
 * Useful for server-side queries without loading a full MemoryDag instance.
 */
export function filterSubtreeFromNodes(
  nodes: MemoryDagNode[],
  rootNodeId: string,
  maxDepth?: number,
  includeExpired?: boolean,
): MemoryDagNode[] {
  const nodeMap = new Map<string, MemoryDagNode>()
  for (const n of nodes) nodeMap.set(n.id, n)

  const root = nodeMap.get(rootNodeId)
  if (!root) return []
  if (!includeExpired && root.expiredAt !== null) return []

  const result: MemoryDagNode[] = [root]
  const depthLimit = maxDepth ?? Infinity
  const queue: Array<{ id: string; depth: number }> = root.childIds.map((cid) => ({ id: cid, depth: 1 }))
  const visited = new Set<string>([rootNodeId])

  let head = 0
  while (head < queue.length) {
    const { id, depth } = queue[head++]
    if (depth > depthLimit) continue
    if (visited.has(id)) continue
    visited.add(id)

    const node = nodeMap.get(id)
    if (!node) continue
    if (!includeExpired && node.expiredAt !== null) continue

    result.push(node)
    for (const cid of node.childIds) {
      if (!visited.has(cid)) {
        queue.push({ id: cid, depth: depth + 1 })
      }
    }
  }

  return result
}
