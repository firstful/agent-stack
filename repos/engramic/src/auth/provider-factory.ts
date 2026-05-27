import type { ProviderConfig } from "../types.js"
import { Provider } from "../provider/index.js"
import { OpenAIProvider } from "../provider/openai.js"
import { EmbeddingsProvider, OpenAIEmbeddingsProvider, NoopEmbeddingsProvider } from "../provider/embeddings.js"

export interface UserProviders {
  chat: Provider
  embeddings: EmbeddingsProvider
}

export function createUserProviders(config: ProviderConfig): UserProviders {
  const chat = new OpenAIProvider(config.apiKey, config.baseUrl)

  const hasApiKey = config.apiKey.length > 0
  const embeddings = hasApiKey
    ? new OpenAIEmbeddingsProvider(config.apiKey, config.baseUrl)
    : new NoopEmbeddingsProvider()

  return { chat, embeddings }
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
