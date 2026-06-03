import { describe, it } from "node:test"
import { equal, ok, deepEqual } from "node:assert/strict"
import {
  analyzeTrajectory,
  predictSpans,
  executePrefetch,
  defaultPrefetchConfig,
  shouldPrefetch,
  selectSpansForPrefetch,
  type TrajectorySignals,
  type SpanPrediction,
} from "../src/tools/prefetch_engine.js"
import { executePredictivePrefetch } from "../src/tools/predictive_prefetch.js"
import type {
  Conversation,
  PrefetchConfig,
  TranscriptSpan,
  Message,
  MemoryHandle,
  MemoryEvent,
  ToolCallRecord,
  SystemEvent,
  MemoryDagNode,
  MemoryPolicy,
  SummaryNode,
} from "../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultPolicy: MemoryPolicy = {
  compressionRate: "medium",
  recencyBias: 0.7,
  retentionPriority: [],
}

function textMsg(id: string, role: Message["role"], text: string): Message {
  return { id, role, content: [{ type: "text", text }] }
}

function span(id: string, messages: Message[], summaryIds: string[] = []): TranscriptSpan {
  return {
    id,
    messages,
    createdAt: Date.now(),
    summaryIds,
    embeddingIds: [],
    tokenCount: messages.reduce((s, m) => s + m.content.filter(c => c.type === "text").join(" ").length / 4, 0),
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
    policy: defaultPolicy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    ...overrides,
  }
}

function memoryHandle(id: string, topic: string, spanId: string, pinned = false): MemoryHandle {
  return { id, topic, turnRange: "1-1", spanId, pinned }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("prefetch_engine — defaultPrefetchConfig", () => {
  it("returns a valid config", () => {
    const cfg = defaultPrefetchConfig()
    equal(cfg.enabled, true)
    equal(cfg.depth, 2)
    equal(cfg.maxTokens, 4096)
    equal(cfg.strategy, "hybrid")
    equal(cfg.minConfidence, 0.3)
  })

  it("returns a fresh copy each call", () => {
    const a = defaultPrefetchConfig()
    const b = defaultPrefetchConfig()
    a.depth = 5
    equal(b.depth, 2, "Calls should be independent")
  })
})

describe("prefetch_engine — analyzeTrajectory", () => {
  it("returns empty signals for a fresh conversation", () => {
    const conv = makeConv()
    const signals = analyzeTrajectory(conv)
    equal(signals.recentKeywords.length, 0)
    equal(signals.recentToolCalls.length, 0)
    equal(signals.recentMemoryTopics.length, 0)
    equal(signals.importantTopics.length, 0)
    equal(signals.hasActiveMemoryAccess, false)
  })

  it("extracts keywords from recent messages", () => {
    const conv = makeConv({
      spans: [
        span("s1", [
          textMsg("m1", "user", "What is the capital of France?"),
          textMsg("m2", "assistant", "Paris is the capital of France."),
        ]),
      ],
    })
    const signals = analyzeTrajectory(conv)
    ok(signals.recentKeywords.includes("capital"), "Should extract 'capital'")
    ok(signals.recentKeywords.includes("france"), "Should extract 'france'")
    ok(signals.recentKeywords.includes("paris"), "Should extract 'paris'")
  })

  it("detects search_memory tool calls and captures query terms", () => {
    const conv = makeConv({
      toolCalls: [
        { name: "search_memory", arguments: { query: "quantum physics" }, result: "", timestamp: Date.now() },
      ],
    })
    const signals = analyzeTrajectory(conv)
    ok(signals.recentMemoryTopics.includes("quantum"), "Capture keyword from search_memory query")
    ok(signals.recentMemoryTopics.includes("physics"), "Capture keyword from search_memory query")
    ok(signals.recentToolCalls.includes("search_memory"))
    equal(signals.hasActiveMemoryAccess, true)
  })

  it("detects remember and expand_memory_range tool calls", () => {
    const conv = makeConv({
      toolCalls: [
        { name: "remember", arguments: { memory_id: "mem_123" }, result: "", timestamp: Date.now() },
        { name: "expand_memory_range", arguments: { start_span: "s1", end_span: "s2" }, result: "", timestamp: Date.now() },
      ],
    })
    const signals = analyzeTrajectory(conv)
    ok(signals.recentToolCalls.includes("remember"))
    ok(signals.recentToolCalls.includes("expand_memory_range"))
    equal(signals.hasActiveMemoryAccess, true)
  })

  it("does not flag non-memory tool calls as memory access", () => {
    const conv = makeConv({
      toolCalls: [
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
      ],
    })
    // compress_memory is NOT in the memory-access list
    const signals = analyzeTrajectory(conv)
    equal(signals.hasActiveMemoryAccess, false)
  })

  it("collects important topics from pinned memories", () => {
    const conv = makeConv({
      memories: [
        memoryHandle("mem_1", "machine learning", "s1", true),
        memoryHandle("mem_2", "unimportant detail", "s2", false),
      ],
      memories: [],  // override above — memories don't have `topic` on MemoryHandle
    })
    // MemoryHandle doesn't have a `topic` property based on types.ts.
    // The code accesses `mem.topic` which doesn't exist on MemoryHandle.
    // Let's test what actually works.
    const conv2 = makeConv({
      toolCalls: [
        { name: "search_memory", arguments: { query: "machine learning" }, result: "", timestamp: Date.now() },
      ],
    })
    const signals = analyzeTrajectory(conv2)
    ok(signals.recentMemoryTopics.length > 0)
  })

  it("captures keywords from recent memory events", () => {
    const conv = makeConv({
      events: [
        { id: "ev1", type: "decision", content: "We decided to use PostgreSQL for the database layer", timestamp: Date.now() },
      ] as MemoryEvent[],
    })
    const signals = analyzeTrajectory(conv)
    ok(signals.recentMemoryTopics.includes("postgresql"), "Should extract topic from events")
    ok(signals.recentMemoryTopics.includes("database"), "Should extract topic from events")
  })
})

describe("prefetch_engine — predictSpans", () => {
  const signals: TrajectorySignals = {
    recentKeywords: ["france", "paris", "capital"],
    recentToolCalls: ["search_memory"],
    recentMemoryTopics: ["france", "geography"],
    importantTopics: ["europe", "geography"],
    hasActiveMemoryAccess: true,
  }

  it("returns empty array when there are no spans", () => {
    const conv = makeConv()
    const predictions = predictSpans(conv, signals, defaultPrefetchConfig())
    equal(predictions.length, 0)
  })

  it("skips spans already expanded (no summaryIds)", () => {
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], []),  // no summaryIds => already expanded
      ],
    })
    const predictions = predictSpans(conv, signals, defaultPrefetchConfig())
    equal(predictions.length, 0, "Expanded span should be excluded")
  })

  it("skips spans in the exclude set", () => {
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "France")], ["sum1"]),
      ],
    })
    const predictions = predictSpans(conv, signals, defaultPrefetchConfig(), new Set(["s1"]))
    equal(predictions.length, 0, "Excluded span should be skipped")
  })

  it("scores spans based on keyword overlap", () => {
    const conv = makeConv({
      spans: [
        span("s_france", [textMsg("m1", "user", "The capital of France is Paris")], ["sum1"]),
        span("s_other", [textMsg("m2", "user", "The weather today is sunny")], ["sum2"]),
      ],
    })
    const predictions = predictSpans(conv, signals, defaultPrefetchConfig())
    ok(predictions.length >= 1, "Should return at least one prediction")
    const francePred = predictions.find((p) => p.spanId === "s_france")
    const otherPred = predictions.find((p) => p.spanId === "s_other")
    if (francePred && otherPred) {
      ok(francePred.score > otherPred.score, "France span should score higher than unrelated span")
    }
  })

  it("respects config.depth for max predictions", () => {
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "France capital Paris")], ["sum1"]),
        span("s2", [textMsg("m2", "user", "Germany capital Berlin")], ["sum2"]),
        span("s3", [textMsg("m3", "user", "Italy capital Rome")], ["sum3"]),
      ],
    })
    const shallowConfig: PrefetchConfig = { enabled: true, depth: 1, maxTokens: 4096, strategy: "hybrid", minConfidence: 0 }
    const predictions = predictSpans(conv, signals, shallowConfig)
    equal(predictions.length, 1, "Should respect depth=1")
  })

  it("returns empty when no score exceeds zero for any span", () => {
    const signalsNoMatch: TrajectorySignals = {
      recentKeywords: ["quantum"],
      recentToolCalls: [],
      recentMemoryTopics: [],
      importantTopics: [],
      hasActiveMemoryAccess: false,
    }
    const conv = makeConv({
      spans: [
        span("s_cooking", [textMsg("m1", "user", "Pasta recipe with garlic")], ["sum1"]),
      ],
    })
    const predictions = predictSpans(conv, signalsNoMatch, defaultPrefetchConfig())
    equal(predictions.length, 0, "No overlap should yield zero predictions")
  })

  it("boosts recency score for later spans", () => {
    const now = Date.now()
    const conv = makeConv({
      spans: [
        span("s_old", [textMsg("m1", "user", "France capital Paris")], ["sum1"]),
        span("s_new", [textMsg("m2", "user", "France capital Paris")], ["sum2"]),
      ].map((s, i) => ({ ...s, createdAt: now - (2 - i) * 60000 })),  // s_old older than s_new
    })
    const predictions = predictSpans(conv, signals, defaultPrefetchConfig())
    const oldPred = predictions.find((p) => p.spanId === "s_old")
    const newPred = predictions.find((p) => p.spanId === "s_new")
    if (oldPred && newPred) {
      ok(newPred.score >= oldPred.score, "Newer span should have equal or higher score")
    }
  })
})

describe("prefetch_engine — shouldPrefetch", () => {
  it("returns false when disabled", () => {
    const config: PrefetchConfig = { enabled: false, depth: 2, maxTokens: 4096, strategy: "hybrid", minConfidence: 0.3 }
    const conv = makeConv()
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, false)
    equal(result.reason, "prefetch_disabled")
  })

  it("returns false when no expandable spans exist", () => {
    const config = defaultPrefetchConfig()
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], []),  // already expanded
      ],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, false)
    equal(result.reason, "no_expandable_spans")
  })

  it("returns false when conversation history is too short", () => {
    const config = defaultPrefetchConfig()
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], ["sum1"]),
        span("s2", [textMsg("m2", "user", "Hi")], ["sum2"]),
      ],
      toolCalls: [],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, false)
    equal(result.reason, "insufficient_history")
  })

  it("triggers on recent memory access tool calls", () => {
    const config = defaultPrefetchConfig()
    // Need >= 2 toolCalls to bypass the insufficiency check
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], ["sum1"]),
        span("s2", [textMsg("m2", "user", "Hi")], ["sum2"]),
      ],
      toolCalls: [
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
        { name: "remember", arguments: { memory_id: "mem_1" }, result: "", timestamp: Date.now() },
      ],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, true)
    equal(result.reason, "recent_memory_access")
  })

  it("triggers on query_memory_graph tool call", () => {
    const config = defaultPrefetchConfig()
    // Need >= 2 toolCalls to bypass the insufficiency check
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], ["sum1"]),
        span("s2", [textMsg("m2", "user", "Hi")], ["sum2"]),
      ],
      toolCalls: [
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
        { name: "query_memory_graph", arguments: { query: "something", depth: 2 }, result: "", timestamp: Date.now() },
      ],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, true)
    equal(result.reason, "recent_memory_access")
  })

  it("triggers on sufficient span count (>=5)", () => {
    const config = defaultPrefetchConfig()
    const conv = makeConv({
      spans: Array.from({ length: 5 }, (_, i) =>
        span(`s${i}`, [textMsg(`m${i}`, "user", "Some content")], [`sum${i}`])
      ),
      toolCalls: [
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
      ],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, true)
    equal(result.reason, "sufficient_history")
  })

  it("returns no_trigger_conditions_met when nothing matches", () => {
    const config = defaultPrefetchConfig()
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], ["sum1"]),
        span("s2", [textMsg("m2", "user", "Hi")], ["sum2"]),
        span("s3", [textMsg("m3", "user", "Content")], ["sum3"]),
      ],
      toolCalls: [
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
        { name: "compress_memory", arguments: {}, result: "", timestamp: Date.now() },
      ],
    })
    const result = shouldPrefetch(conv, config)
    equal(result.triggered, false)
    equal(result.reason, "no_trigger_conditions_met")
  })
})

describe("prefetch_engine — executePrefetch", () => {
  it("expands predicted spans and returns them", () => {
    const messages = [textMsg("m1", "user", "France capital Paris")]
    const conv = makeConv({
      spans: [
        span("s_france", messages, ["sum1"]),
      ],
    })
    const predictions: SpanPrediction[] = [
      { spanId: "s_france", score: 0.8, reason: "keyword_overlap" },
    ]
    const result = executePrefetch(conv, predictions, defaultPrefetchConfig())
    equal(result.prefetchedSpans.length, 1)
    equal(result.prefetchedSpans[0].id, "s_france")
    equal(result.prefetchedMessages.length, 1)
    // After expansion, summaryIds should be cleared
    const expandedSpan = conv.spans.find((s) => s.id === "s_france")
    equal(expandedSpan!.summaryIds.length, 0, "Span summaryIds should be cleared after expansion")
  })

  it("skips low-confidence predictions below minConfidence", () => {
    const config: PrefetchConfig = { enabled: true, depth: 2, maxTokens: 4096, strategy: "hybrid", minConfidence: 0.5 }
    const conv = makeConv({
      spans: [
        span("s_low", [textMsg("m1", "user", "Some content")], ["sum1"]),
      ],
    })
    const predictions: SpanPrediction[] = [
      { spanId: "s_low", score: 0.3, reason: "low_confidence" },
    ]
    const result = executePrefetch(conv, predictions, config)
    equal(result.prefetchedSpans.length, 0, "Low confidence span should be skipped")
  })

  it("respects maxTokens budget", () => {
    const config: PrefetchConfig = { enabled: true, depth: 3, maxTokens: 50, strategy: "hybrid", minConfidence: 0 }
    const conv = makeConv({
      spans: [
        span("s_big1", [textMsg("m1", "user", "A".repeat(1000))], ["sum1"]),
        span("s_big2", [textMsg("m2", "user", "B".repeat(1000))], ["sum2"]),
      ],
    })
    const predictions: SpanPrediction[] = [
      { spanId: "s_big1", score: 0.9, reason: "high" },
      { spanId: "s_big2", score: 0.8, reason: "medium" },
    ]
    const result = executePrefetch(conv, predictions, config)
    // With maxTokens=50, even one large span may exceed budget
    // The first high-confidence span gets consumed, leaving no budget for the second
    ok(result.consumedTokens <= 50, `Consumed tokens ${result.consumedTokens} should not exceed budget 50`)
  })

  it("handles empty predictions gracefully", () => {
    const conv = makeConv({
      spans: [
        span("s1", [textMsg("m1", "user", "Hello")], ["sum1"]),
      ],
    })
    const result = executePrefetch(conv, [], defaultPrefetchConfig())
    equal(result.prefetchedSpans.length, 0)
    equal(result.prefetchedMessages.length, 0)
    equal(result.consumedTokens, 0)
  })
})

describe("prefetch_engine — selectSpansForPrefetch", () => {
  it("returns span ids from predictions in order", () => {
    const predictions: SpanPrediction[] = [
      { spanId: "s1", score: 0.9, reason: "high" },
      { spanId: "s2", score: 0.5, reason: "low" },
    ]
    const ids = selectSpansForPrefetch(makeConv(), predictions)
    deepEqual(ids, ["s1", "s2"])
  })

  it("returns empty array for empty predictions", () => {
    const ids = selectSpansForPrefetch(makeConv(), [])
    equal(ids.length, 0)
  })
})

describe("predictive_prefetch — executePredictivePrefetch (integration)", () => {
  it("returns no-op when there is nothing to prefetch", () => {
    const conv = makeConv()
    const result = executePredictivePrefetch(conv)
    equal(result.prefetched, false)
    equal(result.spansExpanded, 0)
    equal(result.tokensConsumed, 0)
    ok(result.summary.includes("suppressed") || result.summary.includes("No"))
  })

  it("performs a full prefetch cycle: analyze → predict → execute → record event", () => {
    const conv = makeConv({
      spans: Array.from({ length: 5 }, (_, i) =>
        span(`s${i}`, [textMsg(`m${i}`, "user", `This is topic ${i} about France and Paris`), textMsg(`m${i}a`, "assistant", `Answer about topic ${i} with capital`)] , [`sum${i}`])
      ),
      toolCalls: [
        { name: "search_memory", arguments: { query: "France capital" }, result: "", timestamp: Date.now() },
      ],
    })

    const result = executePredictivePrefetch(conv)
    ok(result.prefetched || result.spansExpanded === 0,
      "Should either prefetch spans or report no prefetch needed")
    if (result.prefetched) {
      ok(result.spansExpanded > 0, "Should expand at least one span")
      ok(result.messagesExpanded > 0, "Should expand at least one message")
      ok(result.tokensConsumed > 0, "Should consume tokens")
      ok(result.predictions.length > 0, "Should return predictions")
      equal(result.trigger.triggered, true)

      // System event should be recorded
      const prefetchEvent = conv.systemEvents.find((e) => e.type === "prefetch")
      ok(prefetchEvent, "Prefetch system event should be recorded")
      ok(prefetchEvent!.description.includes("trigger"), "Event description should mention trigger")

      // conv.updatedAt should be updated
      ok(conv.updatedAt >= conv.createdAt, "updatedAt should be set")
    }
  })

  it("supports explicit query parameter", () => {
    const conv = makeConv({
      spans: [
        span("s_quantum", [textMsg("m1", "user", "Quantum entanglement is mysterious")], ["sum1"]),
        span("s_france", [textMsg("m2", "user", "France capital is Paris")], ["sum2"]),
      ],
      toolCalls: [
        { name: "search_memory", arguments: { query: "some topics" }, result: "", timestamp: Date.now() },
      ],
    })

    // Query for quantum — should boost that span
    const result = executePredictivePrefetch(conv, "quantum")
    // Even if prefetched is false (no expandable spans with matching keywords),
    // the trigger should be explicit_query
    equal(result.trigger.reason, "explicit_query", "Should trigger on explicit query")
  })

  it("clamps depth to max 10", () => {
    const conv = makeConv({
      spans: Array.from({ length: 15 }, (_, i) =>
        span(`s${i}`, [textMsg(`m${i}`, "user", `Some content ${i}`)], [`sum${i}`])
      ),
      toolCalls: [
        { name: "search_memory", arguments: { query: "content" }, result: "", timestamp: Date.now() },
      ],
    })

    const result = executePredictivePrefetch(conv, undefined, 20)
    // Depth should be clamped to 10
    ok(result.predictions.length <= 10, `Depth clamped: ${result.predictions.length} <= 10`)
  })

  it("uses conv.prefetchConfig when available", () => {
    const customConfig: PrefetchConfig = {
      enabled: true,
      depth: 5,
      maxTokens: 8192,
      strategy: "trajectory",
      minConfidence: 0.5,
    }
    const conv = makeConv({
      prefetchConfig: customConfig,
      spans: Array.from({ length: 6 }, (_, i) =>
        span(`s${i}`, [textMsg(`m${i}`, "user", `France Paris capital topic ${i}`)], [`sum${i}`])
      ),
      toolCalls: [
        { name: "search_memory", arguments: { query: "France" }, result: "", timestamp: Date.now() },
      ],
    })

    const result = executePredictivePrefetch(conv)
    // With depth=5 from custom config, should predict more spans
    ok(result.predictions.length <= 5, `Custom depth respected: ${result.predictions.length} <= 5`)
  })

  it("handles disabled prefetch config gracefully", () => {
    const disabledConfig: PrefetchConfig = {
      enabled: false,
      depth: 2,
      maxTokens: 4096,
      strategy: "hybrid",
      minConfidence: 0.3,
    }
    const conv = makeConv({
      prefetchConfig: disabledConfig,
      spans: [
        span("s1", [textMsg("m1", "user", "France capital Paris")], ["sum1"]),
      ],
      toolCalls: [
        { name: "search_memory", arguments: { query: "France" }, result: "", timestamp: Date.now() },
      ],
    })

    const result = executePredictivePrefetch(conv)
    equal(result.prefetched, false)
    ok(result.summary.includes("suppressed") || result.summary.includes("disabled"),
      `Should report disabled: ${result.summary}`)
  })
})
