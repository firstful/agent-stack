import { describe, it } from "node:test"
import { equal, deepEqual, ok } from "node:assert/strict"
import {
  OpenAIEmbeddingsProvider,
  EmbeddingCache,
  createEmbeddingsProvider,
  cosineSimilarity,
  NoopEmbeddingsProvider,
  EmbeddingsProvider,
} from "../src/provider/embeddings.js"

describe("OpenAIEmbeddingsProvider", () => {
  it("constructs with defaults", () => {
    const p = new OpenAIEmbeddingsProvider()
    equal(p.name, "openai")
    equal(p.dimensions, 1536)
  })

  it("constructs with custom args", () => {
    const p = new OpenAIEmbeddingsProvider("sk-test", "https://custom.example.com/v1", "custom-model")
    equal(p.name, "openai")
    equal(p.dimensions, 1536)
  })
})

describe("NoopEmbeddingsProvider", () => {
  it("returns empty vectors", async () => {
    const p = new NoopEmbeddingsProvider()
    deepEqual(await p.embed("anything"), [])
    deepEqual(await p.embedBatch(["a", "b"]), [[], []])
  })
})

describe("EmbeddingCache", () => {
  class FakeProvider implements EmbeddingsProvider {
    readonly name = "test"
    readonly dimensions = 4
    callCount = 0

    async embed(text: string): Promise<number[]> {
      this.callCount++
      return [text.length, 0, 0, 0]
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
      return texts.map((t) => {
        this.callCount++
        return [t.length, 0, 0, 0]
      })
    }
  }

  it("caches single embeddings", async () => {
    const inner = new FakeProvider()
    const cache = new EmbeddingCache(inner)

    const v1 = await cache.embed("hello")
    const v2 = await cache.embed("hello")
    deepEqual(v1, v2)
    equal(inner.callCount, 1)
  })

  it("deduplicates across separate calls", async () => {
    const inner = new FakeProvider()
    const cache = new EmbeddingCache(inner)

    const batch1 = await cache.embedBatch(["a", "b"])
    const batch2 = await cache.embedBatch(["a", "c"])
    equal(batch2[0], batch1[0])
    equal(inner.callCount, 3)
  })

  it("clear resets cache", async () => {
    const inner = new FakeProvider()
    const cache = new EmbeddingCache(inner)

    await cache.embed("hello")
    cache.clear()
    await cache.embed("hello")
    equal(inner.callCount, 2)
  })
})

describe("createEmbeddingsProvider", () => {
  it("creates openai by default", () => {
    const p = createEmbeddingsProvider()
    equal(p.name, "openai")
  })

  it("creates noop when asked", () => {
    const p = createEmbeddingsProvider({ kind: "noop" })
    equal(p.name, "noop")
  })
})

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1)
  })

  it("returns 0 for orthogonal vectors", () => {
    equal(cosineSimilarity([1, 0], [0, 1]), 0)
  })

  it("returns 0 for empty vectors", () => {
    equal(cosineSimilarity([], []), 0)
  })

  it("handles mismatched lengths", () => {
    equal(cosineSimilarity([1], [1, 2]), 0)
  })

  it("computes correct similarity", () => {
    const sim = cosineSimilarity([1, 2, 3], [4, 5, 6])
    const expected =
      (1 * 4 + 2 * 5 + 3 * 6) /
      (Math.sqrt(1 + 4 + 9) * Math.sqrt(16 + 25 + 36))
    equal(sim, expected)
  })
})
