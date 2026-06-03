/**
 * KV-cache-aware provider routing.
 *
 * When sequential turns belong to the same conversation, route requests to
 * providers that share KV cache state to avoid cache-miss overhead on
 * provider switches.
 *
 * Strategy:
 * 1. After every successful inference, record the provider label + model
 *    used in the conversation's metadata (`lastProviderLabel`, `lastModel`).
 * 2. On the next request for the same conversation, check if the
 *    previously-used provider can serve the requested model. If yes, route
 *    to it (the upstream API may still have the KV cache warm).
 * 3. If the previous provider cannot serve the model (e.g. model not
 *    available at that endpoint), fall through to normal selection.
 * 4. The `user` parameter (or equivalent) is set to a stable conversation
 *    identifier so upstream providers can maintain per-conversation prefix
 *    caching even across different API keys pointing to the same endpoint.
 */

import type { Conversation, ProviderConfig } from "../types.js"

/**
 * Metadata keys stored on Conversation.metadata for KV-cache affinity.
 */
export const KV_CACHE_META = {
  LAST_PROVIDER_LABEL: "lastProviderLabel",
  LAST_MODEL: "lastModel",
  KV_SESSION_ID: "kvSessionId",
} as const

/**
 * Generate a stable KV-cache session identifier for a conversation.
 * This is used as the `user` parameter in API requests so that upstream
 * providers can maintain per-conversation prefix caching.
 */
export function getKvSessionId(conv: Conversation): string {
  const existing = conv.metadata[KV_CACHE_META.KV_SESSION_ID] as string | undefined
  if (existing) return existing

  const sessionId = `kv_${conv.id.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now().toString(36)}`
  conv.metadata[KV_CACHE_META.KV_SESSION_ID] = sessionId
  return sessionId
}

/**
 * Record which provider was used for the last inference in a conversation.
 * This enables KV-cache-aware routing on the next turn.
 */
export function recordProviderAffinity(
  conv: Conversation,
  providerLabel: string,
  model: string,
): void {
  conv.metadata[KV_CACHE_META.LAST_PROVIDER_LABEL] = providerLabel
  conv.metadata[KV_CACHE_META.LAST_MODEL] = model
}

/**
 * Try to resolve a provider + model that preserves KV-cache affinity.
 *
 * If the conversation has a previously-used provider and that provider can
 * serve the requested model, return it (cache-friendly route). Otherwise
 * return null so the caller falls through to default selection.
 *
 * @param conv        The conversation context.
 * @param modelName   The requested model name (may be "label/model" or bare).
 * @param providers   The account's registered provider configs.
 * @returns           The provider config + resolved model, or null if no
 *                    cache-friendly route is possible.
 */
export function resolveWithKvAffinity(
  conv: Conversation,
  modelName: string,
  providers: ProviderConfig[],
): { provider: ProviderConfig; model: string } | null {
  const lastLabel = conv.metadata[KV_CACHE_META.LAST_PROVIDER_LABEL] as string | undefined
  if (!lastLabel) return null

  // If no providers are registered, cannot route.
  if (providers.length === 0) return null

  // Parse the requested model to extract a provider label if explicit.
  const slashIdx = modelName.indexOf("/")
  let requestedLabel: string | undefined
  let requestedModel: string

  if (slashIdx >= 0) {
    requestedLabel = modelName.slice(0, slashIdx)
    requestedModel = modelName.slice(slashIdx + 1)
  } else {
    requestedModel = modelName
  }

  // If the request explicitly names a different provider than the last one,
  // the caller has a reason — do not override.
  if (requestedLabel && requestedLabel !== lastLabel) {
    return null
  }

  // Find the last-used provider config.
  const lastProvider = providers.find((p) => p.label === lastLabel)
  if (!lastProvider) return null

  // If the request specified a model explicitly and the last provider
  // has that model as its default, use it.
  if (requestedModel) {
    // The provider can serve the requested model — return it.
    return { provider: lastProvider, model: requestedModel }
  }

  // Otherwise fall back to the provider's default model.
  return { provider: lastProvider, model: lastProvider.defaultModel }
}
