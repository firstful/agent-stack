import Fastify from "fastify"
import cors from "@fastify/cors"
import { MemoryStore } from "./memory/store.js"
import { VectorStore } from "./memory/vector.js"
import { ContextEngine } from "./context/engine.js"
import { OpenAIProvider } from "./provider/openai.js"
import { createEmbeddingsProvider } from "./provider/embeddings.js"
import { UserStore } from "./auth/user-store.js"
import { registerRoutes } from "./gateway/index.js"

const PORT = parseInt(process.env.ENGRA_PORT || "3000", 10)
const HOST = process.env.ENGRA_HOST || "0.0.0.0"
const API_KEY = process.env.ENGRA_OPENAI_API_KEY || ""

async function main() {
  const app = Fastify({ logger: true })

  await app.register(cors, { origin: true })

  const store = new MemoryStore()
  const globalProvider = new OpenAIProvider(API_KEY)
  const engine = new ContextEngine()

  const embeddingsProvider = createEmbeddingsProvider({
    kind: API_KEY ? "openai" : "noop",
    apiKey: API_KEY,
  })

  const vectorStore = new VectorStore(embeddingsProvider)

  const userStore = new UserStore()
  await userStore.load()

  registerRoutes(app, store, globalProvider, engine, vectorStore, embeddingsProvider, userStore)

  try {
    await app.listen({ port: PORT, host: HOST })
    console.log(`engramic listening on ${HOST}:${PORT}`)
  } catch (err) {
    console.error("Failed to start:", err)
    process.exit(1)
  }
}

main()
