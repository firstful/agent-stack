// ── remember_cross_session: recall cross-session memories into current conversation ──

import type { Message } from "../types.js"
import type { ICrossSessionStore } from "../memory/cross-session.js"

export interface RememberCrossSessionResult {
  messages: Message[] | null
  summary: string
}

export async function executeRememberCrossSession(
  memoryId: string,
  userId: string,
  crossSessionStore: ICrossSessionStore,
): Promise<RememberCrossSessionResult> {
  const memory = await crossSessionStore.getMemory(userId, memoryId)
  if (!memory) {
    return { messages: null, summary: "Cross-session memory not found" }
  }

  const synthetic: Message = {
    id: `xmem_${Date.now()}`,
    role: "system",
    content: [
      {
        type: "text",
        text: `[Cross-session memory recalled: ${memory.topic}]
Source conversation: ${memory.sourceConversationId}
Summary: ${memory.summaryText}
${memory.pinned ? `(Pinned: ${memory.pinReason ?? "Important"})` : ""}`,
      },
    ],
  }

  return { messages: [synthetic], summary: `Recalled cross-session memory: ${memory.topic}` }
}

export async function executeSearchCrossSession(
  query: string,
  userId: string,
  crossSessionStore: ICrossSessionStore,
  profileId?: string,
): Promise<{ messages: Message[]; summary: string }> {
  const results = await crossSessionStore.searchMemories(userId, query, profileId)

  if (results.length === 0) {
    return {
      messages: [],
      summary: "No cross-session memories found matching your query",
    }
  }

  const text = `Cross-session memory search results for "${query}":
${results
  .map(
    (m) =>
      `- ${m.id}: ${m.topic} (importance: ${m.importanceScore.toFixed(2)})${m.pinned ? " [PINNED]" : ""}`,
  )
  .join("\n")}`

  const toolMsg: Message = {
    id: `tool_xsearch_${Date.now()}`,
    role: "tool",
    content: [{ type: "text", text }],
  }

  return {
    messages: [toolMsg],
    summary: `Found ${results.length} cross-session memories`,
  }
}

export async function executeStoreCrossSessionMemory(
  userId: string,
  topic: string,
  summaryText: string,
  sourceConversationId: string,
  sourceSpanIds: string[],
  crossSessionStore: ICrossSessionStore,
  profileId?: string,
  importanceScore?: number,
): Promise<{ memoryId: string; summary: string }> {
  const { randomUUID } = await import("node:crypto")
  const memoryId = `xmem_${randomUUID().slice(0, 12)}`
  const now = Date.now()

  await crossSessionStore.addMemory(userId, {
    id: memoryId,
    userId,
    profileId,
    topic,
    summaryText,
    sourceConversationId,
    sourceSpanIds,
    importanceScore: importanceScore ?? 0.5,
    pinned: false,
    pinReason: undefined,
    embeddingId: undefined,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  })

  return { memoryId, summary: `Stored cross-session memory: ${topic}` }
}

export async function executePinCrossSessionMemory(
  memoryId: string,
  userId: string,
  reason: string,
  crossSessionStore: ICrossSessionStore,
): Promise<string> {
  const ok = await crossSessionStore.pinMemory(userId, memoryId, reason)
  return ok ? `Pinned cross-session memory ${memoryId}` : `Memory ${memoryId} not found`
}

export async function executeUnpinCrossSessionMemory(
  memoryId: string,
  userId: string,
  crossSessionStore: ICrossSessionStore,
): Promise<string> {
  const ok = await crossSessionStore.unpinMemory(userId, memoryId)
  return ok ? `Unpinned cross-session memory ${memoryId}` : `Memory ${memoryId} not found`
}

export async function executeListCrossSessionMemories(
  userId: string,
  crossSessionStore: ICrossSessionStore,
  profileId?: string,
): Promise<{ messages: Message[]; summary: string }> {
  const memories = await crossSessionStore.getMemories(userId, profileId)

  if (memories.length === 0) {
    return { messages: [], summary: "No cross-session memories" }
  }

  const text = `Cross-session memories (${memories.length} total):
${memories
  .map(
    (m) =>
      `- ${m.id}: ${m.topic} (${new Date(m.createdAt).toLocaleDateString()})${m.pinned ? " [PINNED]" : ""}`,
  )
  .join("\n")}`

  const toolMsg: Message = {
    id: `tool_xlist_${Date.now()}`,
    role: "tool",
    content: [{ type: "text", text }],
  }

  return { messages: [toolMsg], summary: `Listed ${memories.length} cross-session memories` }
}
