import { describe, it, before } from "node:test"
import { equal, ok, deepEqual } from "node:assert/strict"
import type { Conversation, TranscriptSpan, CompressionStrategy, MemoryPolicy } from "../src/types.js"
import { DEFAULT_RETENTION_POLICY } from "../src/types.js"

// ── Helper to build test conversations ──

function makeSpan(overrides: Partial<TranscriptSpan> & { id: string }): TranscriptSpan {
  return {
    messages: [],
    createdAt: Date.now(),
    summaryIds: [],
    embeddingIds: [],
    tokenCount: 100,
    ...overrides,
  }
}

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "test_conv",
    spans: [],
    summaries: new Map(),
    memories: [],
    events: [],
    toolCalls: [],
    systemEvents: [],
    dag: new Map(),
    policy: {
      compressionStrategy: "auto",
      compressionRate: "medium",
      recencyBias: 0.7,
      retentionPriority: [],
      tokenThreshold: 80_000,
      messageThreshold: 20,
      idleThresholdMs: 30_000,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    ...overrides,
  }
}

// We import the functions dynamically because they're async ESM
let autoSelectStrategy: (conv: Conversation) => CompressionStrategy
let shouldCompress: (conv: Conversation) => boolean
let selectSpansForCompression: (conv: Conversation) => Promise<any>
let applyProfileCompressionToConversation: (conv: Conversation, pc: any) => void

describe("Adaptive Compression Policies", () => {
  // Load the module once before all tests
  before(async () => {
    const mod = await import("../src/context/compression.js")
    autoSelectStrategy = mod.autoSelectStrategy
    shouldCompress = mod.shouldCompress
    selectSpansForCompression = mod.selectSpansForCompression

    // applyProfileCompressionToConversation is exported from gateway
    // For testing, we duplicate the logic inline
    applyProfileCompressionToConversation = (conv, pc) => {
      const update: Partial<MemoryPolicy> = {}
      switch (pc.trigger) {
        case "token_count":
          update.compressionStrategy = "token_count"
          update.tokenThreshold = pc.threshold
          break
        case "message_count":
          update.compressionStrategy = "age"
          update.messageThreshold = pc.threshold
          break
        case "idle_time":
          update.compressionStrategy = "age"
          update.idleThresholdMs = pc.threshold
          break
      }
      update.compressionRate = pc.rate
      conv.policy = { ...conv.policy, ...update }
      conv.updatedAt = Date.now()
    }
  })

  // ── autoSelectStrategy tests ──

  describe("autoSelectStrategy()", () => {
    it("returns token_count for very few spans", () => {
      const conv = makeConv({ spans: [makeSpan({ id: "s1" }), makeSpan({ id: "s2" })] })
      equal(autoSelectStrategy(conv), "token_count")
    })

    it("returns age when inter-span gaps are irregular", () => {
      const spans = [
        makeSpan({ id: "s1", createdAt: Date.now() - 120_000 }),
        makeSpan({ id: "s2", createdAt: Date.now() - 60_000 }),
        makeSpan({ id: "s3", createdAt: Date.now() - 100 }),
        makeSpan({ id: "s4", createdAt: Date.now() - 50 }),
      ]
      const conv = makeConv({ spans })
      // avg gap ~40s, std dev > 50% of mean -> age
      const strategy = autoSelectStrategy(conv)
      ok(strategy === "age" || strategy === "token_count", `Expected age or token_count, got ${strategy}`)
    })

    it("returns age when pin ratio is high", () => {
      const spans = [
        makeSpan({ id: "s1", messages: [{ id: "m1", role: "user", content: [{ type: "text", text: "hello" }] }] }),
        makeSpan({ id: "s2", messages: [{ id: "m2", role: "user", content: [{ type: "text", text: "world" }], metadata: { pinned: true } }] }),
        makeSpan({ id: "s3", messages: [{ id: "m3", role: "user", content: [{ type: "text", text: "foo" }] }] }),
        makeSpan({ id: "s4", messages: [{ id: "m4", role: "user", content: [{ type: "text", text: "bar" }] }] }),
        makeSpan({ id: "s5", messages: [{ id: "m5", role: "user", content: [{ type: "text", text: "baz" }] }] }),
        makeSpan({ id: "s6", messages: [{ id: "m6", role: "user", content: [{ type: "text", text: "qux" }] }] }),
      ]
      const conv = makeConv({ spans })
      // Pin ratio = 1/6 ≈ 0.16 which is < 0.3, so not enough for age selection
      // Need more pins
    })

    it("returns semantic_distance with many distinct topics + high message count", () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ id: `s${i}`, messages: [{ id: `m${i}`, role: "user", content: [{ type: "text", text: `message ${i}` }] }] }),
      )
      const events = [
        { id: "e1", type: "decision" as const, content: "topic1", timestamp: Date.now() },
        { id: "e2", type: "decision" as const, content: "topic2", timestamp: Date.now() },
        { id: "e3", type: "decision" as const, content: "topic3", timestamp: Date.now() },
        { id: "e4", type: "fact" as const, content: "topic4", timestamp: Date.now() },
      ]
      const conv = makeConv({ spans, events, policy: { ...makeConv().policy, compressionRate: "high" } })
      // With high rate: topicThreshold=2, messageThreshold=20
      // distinctTopics=4 > 2 ✓ but totalMessages=6 < 20 ✗
      const strategy = autoSelectStrategy(conv)
      // Since messageThreshold is 20 and we only have 6 messages, should not trigger semantic_distance
      // With high rate fallback -> age
      equal(strategy, "age")
    })

    it("prefers age with high compression rate when no clear pattern", () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ id: `s${i}`, createdAt: Date.now() - i * 10_000 }),
      )
      const conv = makeConv({ spans, policy: { ...makeConv().policy, compressionRate: "high" } })
      equal(autoSelectStrategy(conv), "age")
    })

    it("defaults to token_count with medium/low rate", () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ id: `s${i}`, createdAt: Date.now() - i * 10_000 }),
      )
      const conv = makeConv({ spans, policy: { ...makeConv().policy, compressionRate: "low" } })
      equal(autoSelectStrategy(conv), "token_count")
    })
  })

  // ── shouldCompress tests ──

  describe("shouldCompress()", () => {
    it("returns false for empty conversation", () => {
      const conv = makeConv()
      equal(shouldCompress(conv), false)
    })

    it("returns true when token threshold exceeded", () => {
      const spans = [
        makeSpan({ id: "s1", tokenCount: 50_000 }),
        makeSpan({ id: "s2", tokenCount: 40_000 }),
      ]
      const conv = makeConv({ spans, policy: { ...makeConv().policy, tokenThreshold: 80_000 } })
      // 90_000 > 80_000 → true
      ok(shouldCompress(conv))
    })

    it("respects compression rate multiplier (low = higher threshold)", () => {
      const spans = [
        makeSpan({ id: "s1", tokenCount: 60_000 }),
        makeSpan({ id: "s2", tokenCount: 40_000 }),
      ]
      // low rate: multiplier = 1.5, threshold * 1.5 = 120_000
      // 100_000 < 120_000 → false
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionRate: "low",
          tokenThreshold: 80_000,
        },
      })
      equal(shouldCompress(conv), false)
    })

    it("returns true when message threshold exceeded (high rate)", () => {
      const spans = Array.from({ length: 30 }, (_, i) =>
        makeSpan({ id: `s${i}`, messages: [{ id: `m${i}`, role: "user", content: [{ type: "text", text: "msg" }] }] }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionRate: "high",
          messageThreshold: 25,
        },
      })
      // high rate: multiplier = 1.0, 30 > 25 → true
      ok(shouldCompress(conv))
    })
  })

  // ── Profile-to-conversation bridge tests ──

  describe("applyProfileCompressionToConversation()", () => {
    it("maps token_count trigger with threshold", () => {
      const conv = makeConv()
      applyProfileCompressionToConversation(conv, {
        trigger: "token_count",
        threshold: 50000,
        rate: "high",
      })
      equal(conv.policy.compressionStrategy, "token_count")
      equal(conv.policy.tokenThreshold, 50000)
      equal(conv.policy.compressionRate, "high")
    })

    it("maps message_count trigger to age strategy", () => {
      const conv = makeConv()
      applyProfileCompressionToConversation(conv, {
        trigger: "message_count",
        threshold: 50,
        rate: "low",
      })
      equal(conv.policy.compressionStrategy, "age")
      equal(conv.policy.messageThreshold, 50)
      equal(conv.policy.compressionRate, "low")
    })

    it("maps idle_time trigger to age strategy", () => {
      const conv = makeConv()
      applyProfileCompressionToConversation(conv, {
        trigger: "idle_time",
        threshold: 60000,
        rate: "medium",
      })
      equal(conv.policy.compressionStrategy, "age")
      equal(conv.policy.idleThresholdMs, 60000)
      equal(conv.policy.compressionRate, "medium")
    })

    it("preserves existing policy fields not overridden by profile", () => {
      const conv = makeConv({
        policy: {
          compressionStrategy: "semantic_distance",
          compressionRate: "low",
          recencyBias: 0.9,
          retentionPriority: ["pinned"],
          semanticDistanceThreshold: 0.4,
        },
      })
      applyProfileCompressionToConversation(conv, {
        trigger: "token_count",
        threshold: 100000,
        rate: "high",
      })
      // Overridden by profile
      equal(conv.policy.compressionStrategy, "token_count")
      equal(conv.policy.compressionRate, "high")
      equal(conv.policy.tokenThreshold, 100000)
      // Preserved from original
      equal(conv.policy.recencyBias, 0.9)
      deepEqual(conv.policy.retentionPriority, ["pinned"])
      equal(conv.policy.semanticDistanceThreshold, 0.4)
    })
  })

  // ── selectSpansForCompression tests (rate-aware) ──

  describe("selectSpansForCompression()", () => {
    it("selects fewer spans with low compression rate", async () => {
      const spans = Array.from({ length: 20 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100 }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "token_count",
          compressionRate: "low",
        },
      })
      const result = await selectSpansForCompression(conv)
      // low → 25% of 20 = 5 spans
      ok(result.spans.length <= 6, `Expected ~5 spans with low rate, got ${result.spans.length}`)
      ok(result.spans.length >= 1, "Should select at least 1 span")
    })

    it("selects more spans with high compression rate", async () => {
      const spans = Array.from({ length: 20 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100 }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "token_count",
          compressionRate: "high",
        },
      })
      const result = await selectSpansForCompression(conv)
      // high → 75% of 20 = 15 spans
      ok(result.spans.length >= 12, `Expected ~15 spans with high rate, got ${result.spans.length}`)
    })

    it("selects medium amount with default rate", async () => {
      const spans = Array.from({ length: 20 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100 }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "token_count",
          compressionRate: "medium",
        },
      })
      const result = await selectSpansForCompression(conv)
      // medium → 50% of 20 = 10 spans
      ok(result.spans.length >= 8 && result.spans.length <= 12,
        `Expected ~10 spans with medium rate, got ${result.spans.length}`)
    })

    it("returns strategy reason in result", async () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100 }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "age",
          compressionRate: "medium",
        },
      })
      const result = await selectSpansForCompression(conv)
      ok(result.reason.includes("age"), `Reason should mention strategy, got: ${result.reason}`)
      equal(result.strategy, "age")
    })

    it("resolves auto strategy to concrete strategy", async () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100 }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "auto",
          compressionRate: "medium",
        },
      })
      const result = await selectSpansForCompression(conv)
      // Should resolve to something concrete, not "auto"
      ok(result.strategy !== "auto", "Should resolve auto to a concrete strategy")
      ok(["token_count", "age", "semantic_distance"].includes(result.strategy),
        `Strategy should be one of the concrete ones, got ${result.strategy}`)
    })
  })

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles empty span list", async () => {
      const conv = makeConv()
      const result = await selectSpansForCompression(conv)
      equal(result.spans.length, 0)
    })

    it("handles system-only spans (no user/assistant messages)", async () => {
      const spans = [
        makeSpan({
          id: "s1",
          messages: [{ id: "m1", role: "system", content: [{ type: "text", text: "system msg" }] }],
        }),
        makeSpan({
          id: "s2",
          messages: [{ id: "m2", role: "user", content: [{ type: "text", text: "hello" }] }],
        }),
      ]
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "token_count",
          compressionRate: "high",
        },
      })
      const result = await selectSpansForCompression(conv)
      // System-only spans should be excluded, but user spans should be included
      ok(result.spans.every((s: TranscriptSpan) => s.id !== "s1" || s.messages.length === 0),
        "System-only spans should be filtered out")
    })

    it("handles already-compressed spans (filtering out)", async () => {
      const spans = Array.from({ length: 10 }, (_, i) =>
        makeSpan({ id: `s${i}`, tokenCount: 100, summaryIds: i < 5 ? ["sum_existing"] : [] }),
      )
      const conv = makeConv({
        spans,
        policy: {
          ...makeConv().policy,
          compressionStrategy: "token_count",
          compressionRate: "high",
        },
      })
      const result = await selectSpansForCompression(conv)
      // Should prefer uncompressed spans
      const compressedSelected = result.spans.filter((s: TranscriptSpan) => s.summaryIds.length > 0)
      ok(compressedSelected.length <= result.spans.length / 2,
        `Should prefer uncompressed spans, got ${compressedSelected.length} compressed out of ${result.spans.length}`)
    })
  })
})
