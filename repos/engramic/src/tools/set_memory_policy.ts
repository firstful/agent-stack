import type { Conversation, CompressionRate, CompressionStrategy, MemoryPolicy } from "../types.js"

export interface SetMemoryPolicyResult {
  policy: MemoryPolicy
  applied: boolean
  message: string
}

const VALID_STRATEGIES: CompressionStrategy[] = ["token_count", "age", "semantic_distance", "auto"]

/**
 * Set or update the memory policy for a conversation.
 * Supports compression strategy selection, rate, bias, threshold overrides,
 * and retention priorities.
 */
export function executeSetMemoryPolicy(
  conv: Conversation,
  params: {
    compressionStrategy?: CompressionStrategy
    compressionRate?: CompressionRate
    recencyBias?: number
    retentionPriority?: string[]
    tokenThreshold?: number
    messageThreshold?: number
    idleThresholdMs?: number
    semanticDistanceThreshold?: number
  },
): SetMemoryPolicyResult {
  const update: Partial<MemoryPolicy> = {}

  if (params.compressionStrategy) {
    if (!VALID_STRATEGIES.includes(params.compressionStrategy)) {
      return {
        policy: conv.policy,
        applied: false,
        message: `Invalid compression strategy: ${params.compressionStrategy}. Must be one of: ${VALID_STRATEGIES.join(", ")}`,
      }
    }
    update.compressionStrategy = params.compressionStrategy
  }

  if (params.compressionRate) {
    const validRates: CompressionRate[] = ["low", "medium", "high"]
    if (!validRates.includes(params.compressionRate)) {
      return {
        policy: conv.policy,
        applied: false,
        message: `Invalid compression rate: ${params.compressionRate}. Must be one of: ${validRates.join(", ")}`,
      }
    }
    update.compressionRate = params.compressionRate
  }

  if (params.recencyBias !== undefined) {
    if (params.recencyBias < 0 || params.recencyBias > 1) {
      return {
        policy: conv.policy,
        applied: false,
        message: `recencyBias must be between 0 and 1, got ${params.recencyBias}`,
      }
    }
    update.recencyBias = params.recencyBias
  }

  if (params.retentionPriority) {
    update.retentionPriority = params.retentionPriority
  }

  if (params.tokenThreshold !== undefined) {
    if (params.tokenThreshold < 1_000) {
      return {
        policy: conv.policy,
        applied: false,
        message: `tokenThreshold must be at least 1_000, got ${params.tokenThreshold}`,
      }
    }
    update.tokenThreshold = params.tokenThreshold
  }

  if (params.messageThreshold !== undefined) {
    if (params.messageThreshold < 1) {
      return {
        policy: conv.policy,
        applied: false,
        message: `messageThreshold must be at least 1, got ${params.messageThreshold}`,
      }
    }
    update.messageThreshold = params.messageThreshold
  }

  if (params.idleThresholdMs !== undefined) {
    if (params.idleThresholdMs < 1_000) {
      return {
        policy: conv.policy,
        applied: false,
        message: `idleThresholdMs must be at least 1_000, got ${params.idleThresholdMs}`,
      }
    }
    update.idleThresholdMs = params.idleThresholdMs
  }

  if (params.semanticDistanceThreshold !== undefined) {
    if (params.semanticDistanceThreshold < 0 || params.semanticDistanceThreshold > 1) {
      return {
        policy: conv.policy,
        applied: false,
        message: `semanticDistanceThreshold must be between 0 and 1, got ${params.semanticDistanceThreshold}`,
      }
    }
    update.semanticDistanceThreshold = params.semanticDistanceThreshold
  }

  conv.policy = { ...conv.policy, ...update }
  conv.updatedAt = Date.now()

  const parts: string[] = []
  if (update.compressionStrategy) parts.push(`strategy=${conv.policy.compressionStrategy}`)
  if (update.compressionRate) parts.push(`rate=${conv.policy.compressionRate}`)
  if (params.recencyBias !== undefined) parts.push(`recencyBias=${conv.policy.recencyBias}`)
  if (params.retentionPriority) parts.push(`retentionPriority=[${conv.policy.retentionPriority.join(", ")}]`)
  if (update.tokenThreshold !== undefined) parts.push(`tokenThreshold=${conv.policy.tokenThreshold}`)
  if (update.messageThreshold !== undefined) parts.push(`messageThreshold=${conv.policy.messageThreshold}`)
  if (update.idleThresholdMs !== undefined) parts.push(`idleThresholdMs=${conv.policy.idleThresholdMs}`)
  if (update.semanticDistanceThreshold !== undefined) parts.push(`semanticDistanceThreshold=${conv.policy.semanticDistanceThreshold}`)

  return {
    policy: conv.policy,
    applied: true,
    message: `Memory policy updated: ${parts.join(", ")}`,
  }
}
