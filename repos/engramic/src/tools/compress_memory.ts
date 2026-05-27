import type { Conversation } from "../types.js"

export type CompressionLevel = "light" | "medium" | "aggressive"

export interface CompressMemoryResult {
  spanIds: string[]
  level: CompressionLevel
  summaryId: string | null
  message: string
}

export function executeCompressMemory(
  conv: Conversation,
  scopeId: string,
  level: CompressionLevel,
): CompressMemoryResult {
  const targetSpans = conv.spans.filter((s) => s.id === scopeId || scopeId === "all")

  if (targetSpans.length === 0) {
    return { spanIds: [], level, summaryId: null, message: `No spans found for scope: ${scopeId}` }
  }

  const ratioMap: Record<CompressionLevel, number> = { light: 0.3, medium: 0.6, aggressive: 0.9 }
  const targetRatio = ratioMap[level]

  const spanIds = targetSpans.map((s) => s.id)
  const msg = `Compression scheduled for ${targetSpans.length} span(s) at ${level} level (target ratio: ${targetRatio}). Actual compression occurs on next provider summarization pass.`

  return { spanIds, level, summaryId: null, message: msg }
}
