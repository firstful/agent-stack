import type { Conversation, CompressionRate, MemoryPolicy } from "../types.js"

export interface SetMemoryPolicyResult {
  policy: MemoryPolicy
  applied: boolean
  message: string
}

export function executeSetMemoryPolicy(
  conv: Conversation,
  params: {
    compressionRate?: CompressionRate
    recencyBias?: number
    retentionPriority?: string[]
  },
): SetMemoryPolicyResult {
  const update: Partial<MemoryPolicy> = {}

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

  conv.policy = { ...conv.policy, ...update }
  conv.updatedAt = Date.now()

  return {
    policy: conv.policy,
    applied: true,
    message: `Memory policy updated: compressionRate=${conv.policy.compressionRate}, recencyBias=${conv.policy.recencyBias}, retentionPriority=[${conv.policy.retentionPriority.join(", ")}]`,
  }
}
