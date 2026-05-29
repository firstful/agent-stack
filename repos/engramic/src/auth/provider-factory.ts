import type { ProviderConfig, Profile, Account } from "../types.js"
import { Provider } from "../provider/index.js"
import { OpenAIProvider } from "../provider/openai.js"
import { EmbeddingsProvider, OpenAIEmbeddingsProvider, NoopEmbeddingsProvider } from "../provider/embeddings.js"

export interface UserProviders {
  chat: Provider
  embeddings: EmbeddingsProvider
}

export interface ProfileProviders {
  chat: Provider
  summarization: Provider
  embeddings: EmbeddingsProvider
  chatModel: string
  summarizationModel: string
}

export function createUserProviders(config: ProviderConfig): UserProviders {
  const chat = new OpenAIProvider(config.apiKey, config.baseUrl)

  const hasApiKey = config.apiKey.length > 0
  const embeddings = hasApiKey
    ? new OpenAIEmbeddingsProvider(config.apiKey, config.baseUrl)
    : new NoopEmbeddingsProvider()

  return { chat, embeddings }
}

function resolveModel(modelField: string, providerConfig: ProviderConfig, modelPreferences: string[]): string {
  if (modelField === "auto") {
    for (const pref of modelPreferences) {
      if (providerConfig.defaultModel === pref || pref === "*") {
        return providerConfig.defaultModel
      }
    }
    return providerConfig.defaultModel
  }
  return modelField
}

export function createProfileProviders(profile: Profile, account: Account): ProfileProviders {
  const execConfig = account.providers.find((p) => p.label === profile.execution.provider)
  const sumConfig = account.providers.find((p) => p.label === profile.summarization.provider)
  const embConfig = account.providers.find((p) => p.label === profile.embedding.provider)

  if (!execConfig) {
    throw new Error(`Execution provider '${profile.execution.provider}' not found in account`)
  }

  const chat = new OpenAIProvider(execConfig.apiKey, execConfig.baseUrl)
  const chatModel = resolveModel(profile.execution.model, execConfig, profile.modelPreferences)

  let summarization = chat
  let summarizationModel = chatModel
  if (sumConfig) {
    if (sumConfig.label !== execConfig.label) {
      summarization = new OpenAIProvider(sumConfig.apiKey, sumConfig.baseUrl)
    }
    summarizationModel = resolveModel(profile.summarization.model, sumConfig, profile.modelPreferences)
  }

  const embeddings = embConfig && embConfig.apiKey.length > 0
    ? new OpenAIEmbeddingsProvider(embConfig.apiKey, embConfig.baseUrl)
    : execConfig.apiKey.length > 0
    ? new OpenAIEmbeddingsProvider(execConfig.apiKey, execConfig.baseUrl)
    : new NoopEmbeddingsProvider()

  return { chat, summarization, embeddings, chatModel, summarizationModel }
}

const FALLBACK_API_KEY = process.env.ENGRA_OPENAI_API_KEY || ""
const FALLBACK_BASE_URL = process.env.ENGRA_OPENAI_BASE_URL || "https://api.openai.com/v1"

export function createFallbackProviders(): UserProviders {
  return createUserProviders({
    label: "default",
    providerType: "openai",
    apiKey: FALLBACK_API_KEY,
    baseUrl: FALLBACK_BASE_URL,
    defaultModel: "gpt-4o",
  })
}
