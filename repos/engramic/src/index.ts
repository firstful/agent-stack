import Fastify from "fastify"
import cors from "@fastify/cors"
import { MemoryStore, type IMemoryStore } from "./memory/store.js"
import { PgMemoryStore } from "./memory/pg-store.js"
import { VectorStore } from "./memory/vector.js"
import { PgVectorStore } from "./memory/pg-vector-store.js"
import { ContextEngine } from "./context/engine.js"
import { OpenAIProvider } from "./provider/openai.js"
import { createEmbeddingsProvider } from "./provider/embeddings.js"
import { UserStore } from "./auth/user-store.js"
import { PgUserStore } from "./auth/pg-user-store.js"
import type { IUserStore } from "./auth/user-store.js"
import { UsageStore } from "./usage/store.js"
import { PgUsageStore } from "./usage/pg-store.js"
import type { IUsageStore } from "./usage/store.js"
import { PricingEngine } from "./usage/pricing.js"
import { MetricsCollector } from "./usage/metrics.js"
import { registerRoutes } from "./gateway/index.js"
import { runMigrations } from "./db/migrate.js"

const PORT = parseInt(process.env.ENGRA_PORT || "3000", 10)
const HOST = process.env.ENGRA_HOST || "0.0.0.0"
const API_KEY = process.env.ENGRA_OPENAI_API_KEY || ""
const DATABASE_URL = process.env.ENGRA_DATABASE_URL || ""

async function main() {
  const app = Fastify({ logger: true })

  await app.register(cors, { origin: true })

  if (DATABASE_URL) {
    await runMigrations(DATABASE_URL)
  }

  const globalProvider = new OpenAIProvider(API_KEY)
  const engine = new ContextEngine()

  const embeddingsProvider = createEmbeddingsProvider({
    kind: API_KEY ? "openai" : "noop",
    apiKey: API_KEY,
  })

  const store: IMemoryStore = DATABASE_URL
    ? new PgMemoryStore()
    : new MemoryStore()

  const vectorStore = DATABASE_URL
    ? new PgVectorStore(embeddingsProvider)
    : new VectorStore(embeddingsProvider)

  const userStore: IUserStore = DATABASE_URL
    ? new PgUserStore()
    : new UserStore()
  await userStore.load()

  const pricingEngine = new PricingEngine()
  const usageStore: IUsageStore = DATABASE_URL
    ? new PgUsageStore(pricingEngine)
    : new UsageStore(pricingEngine)
  if (usageStore instanceof UsageStore) {
    await usageStore.load()
  } else if (usageStore instanceof PgUsageStore) {
    await usageStore.init()
  }

  const metricsCollector = new MetricsCollector()

  const retentionDays = parseInt(process.env.ENGRA_USAGE_RETENTION_DAYS || "90", 10)
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000
  async function pruneUsage(): Promise<void> {
    const cutoff = Date.now() - retentionMs
    const pruned = await usageStore.pruneOlderThan(cutoff)
    if (pruned > 0) console.log(`Pruned ${pruned} old usage records`)
  }
  pruneUsage()
  setInterval(pruneUsage, 6 * 60 * 60 * 1000)

  registerRoutes(app, store, globalProvider, engine, vectorStore, embeddingsProvider, userStore, usageStore, metricsCollector)

  try {
    await app.listen({ port: PORT, host: HOST })
    console.log(`engramic listening on ${HOST}:${PORT}`)
  } catch (err) {
    console.error("Failed to start:", err)
    process.exit(1)
  }
}

main()
