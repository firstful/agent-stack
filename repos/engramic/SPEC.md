# Semantic Context Virtualization Middleware (SCVM)

## Overview

SCVM is a stateful middleware server that exposes an OpenAI-compatible API while transparently virtualizing conversational context.

The middleware:

- intercepts inference requests
- manages hierarchical conversational memory
- compresses inactive transcript regions
- injects hidden memory tools
- dynamically rehydrates exact transcript spans on demand
- minimizes effective token usage while preserving semantic continuity

The end user and client application remain unaware of:

- summarization
- transcript paging
- memory expansion
- hidden tool execution
- internal orchestration

The system behaves as a transparent inference proxy.

---

# Core Design Goals

## Functional Goals

1. OpenAI-compatible API surface
2. Transparent context compression
3. Reversible summarization
4. On-demand transcript rehydration
5. Hidden middleware-managed tools
6. Provider abstraction
7. Streaming support
8. Deterministic event ordering
9. Persistent conversational memory
10. Token cost reduction

---

## Non-Goals

1. Human-readable memory UI
2. Permanent irreversible summarization
3. User-visible memory operations
4. Fine-tuning models
5. Long-term semantic knowledge graph (initial version)
6. Autonomous agent planning runtime

---

# High-Level Architecture

```
                ┌─────────────────────┐
                │ Client / SDK        │
                └─────────┬───────────┘
                          │
                 OpenAI-compatible API
                          │
                ┌─────────▼───────────┐
                │ SCVM Gateway        │
                │                     │
                │ Request Translator  │
                │ Stream Orchestrator │
                │ Tool Interceptor    │
                └─────────┬───────────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
 ┌────────────────┐ ┌──────────────┐ ┌───────────────┐
 │ Context Engine │ │ Memory Store │ │ Provider Layer│
 └────────────────┘ └──────────────┘ └───────────────┘
          │
          ▼
 ┌────────────────────┐
 │ Compression Engine │
 └────────────────────┘
```

---

# Primary Concepts

## Transcript Span

Immutable contiguous conversational region.

Example:

```
Turns 1-10
```

Each span:

- has a stable ID
- contains raw messages
- may have summaries
- may have embeddings
- may be recursively compressed

---

## Summary Node

Compressed semantic representation of one or more transcript spans.

Example:

```json
{
  "id": "sum_14af92",
  "source_spans": ["span_1"],
  "summary": "...",
  "importance": 0.72
}
```

Summaries are:

- reversible
- non-destructive
- recursively composable

---

## Memory Handle

Stable identifier exposed to model tools.

Example:

```json
{
  "id": "mem_14af92",
  "topic": "OAuth architecture discussion",
  "turn_range": "1-10"
}
```

Memory handles are:

- semantic affordances
- not opaque hashes alone

---

## Working Set

Currently materialized transcript context included in provider prompt.

The working set is dynamic.

---

# API Compatibility

## Supported Endpoints

### Required

```
POST /v1/chat/completions
POST /v1/responses
GET  /v1/models
```

### Optional

```
POST /v1/embeddings
POST /v1/realtime
```

---

# Internal Canonical Representation

The system MUST NOT internally depend on OpenAI schemas.

Define canonical types.

---

## Canonical Message

```ts
interface Message {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: ContentPart[]
  metadata?: Record<string, unknown>
}
```

---

## Content Part

```ts
type ContentPart =
  | TextPart
  | ImagePart
  | ToolCallPart
  | ToolResultPart
```

---

## Transcript Span

```ts
interface TranscriptSpan {
  id: string

  messages: Message[]

  createdAt: number

  summaryIds: string[]

  embeddingIds: string[]

  tokenCount: number
}
```

---

## Summary Node

```ts
interface SummaryNode {
  id: string

  sourceSpanIds: string[]

  summaryText: string

  importanceScore: number

  compressionRatio: number

  parentSummaryIds: string[]

  childSummaryIds: string[]
}
```

---

# Compression Lifecycle

## Trigger Conditions

Compression MAY occur when:

- token threshold exceeded
- turn threshold exceeded
- idle duration exceeded
- provider context limit approached

---

## Compression Flow

```
Transcript Spans
        ↓
Summarization Request
        ↓
Summary Node Creation
        ↓
Working Set Replacement
        ↓
Raw Span Archived
```

Raw spans MUST remain recoverable.

---

# Hidden Middleware Tools

## Tool Injection

The middleware injects hidden tools into provider requests.

These tools MUST NOT be visible to:

- client
- end user

---

# Required Hidden Tools

## remember()

Expands compressed memory regions.

### Schema

```json
{
  "name": "remember",
  "description": "Expand compressed conversational memory",
  "parameters": {
    "type": "object",
    "properties": {
      "memory_id": {
        "type": "string"
      }
    },
    "required": ["memory_id"]
  }
}
```

---

## search_memory()

Semantic lookup across compressed history.

### Schema

```json
{
  "name": "search_memory",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string"
      }
    }
  }
}
```

---

# Tool Interception

Middleware MUST intercept hidden tool calls before client visibility.

---

## remember() Execution Flow

```
Model emits remember(mem_14af92)
            ↓
Middleware intercepts
            ↓
Expand raw transcript span
            ↓
Replace summary node
            ↓
Resubmit inference
            ↓
Suppress tool visibility
            ↓
Return final response only
```

The user MUST NEVER observe:

- tool calls
- reinference passes
- hidden orchestration

---

# Recursive Expansion

Summary nodes MAY contain child summaries.

Expansion MAY be:

- shallow
- recursive
- selective

---

# Context Assembly Engine

## Responsibilities

1. Build optimized provider prompts
2. Maintain token budgets
3. Prioritize active memory
4. Substitute summaries dynamically
5. Expand memories on demand

---

## Assembly Strategy

Priority order:

```
1. System prompt
2. Current user turn
3. Active working set
4. High-importance memories
5. Summaries
6. Archived references
```

---

# Streaming Architecture

Streaming MUST support:

- provider SSE
- hidden reinference
- deterministic ordering

---

## Important Requirement

The middleware MUST buffer provider output until:

- hidden tool orchestration completes
- final visible response stabilized

Otherwise users may observe:

- partial hidden tool sequences
- inconsistent response revisions

---

# Provider Layer

## Responsibilities

1. Normalize provider APIs
2. Translate schemas
3. Repair malformed streams
4. Standardize tool semantics

---

## Provider Capability Model

```ts
interface ProviderCapabilities {
  tools: boolean
  streaming: boolean
  vision: boolean
  jsonMode: boolean
  parallelToolCalls: boolean
  reasoningTokens: boolean
}
```

---

# Memory Ranking

Each span and summary SHOULD maintain:

```
importanceScore: number
```

Factors:

- user preferences
- explicit decisions
- architectural conclusions
- unresolved tasks
- repeated references

---

# Persistence Requirements

The following MUST persist durably:

1. Raw transcript spans
2. Summary nodes
3. Embeddings
4. Memory handles
5. Conversation DAG
6. Tool orchestration state

---

# Storage Model

Recommended:

- PostgreSQL for metadata
- Object store for transcripts
- Vector DB for embeddings
- Redis for hot working set cache

---

# Failure Handling

## Summary Corruption

If summary confidence degrades:

- force rehydration
- regenerate summaries

---

## Expansion Failure

If remember() expansion fails:

- fallback to existing summary
- log degraded-memory event

---

## Provider Failure During Hidden Reinference

Middleware MUST:

- retry provider call
- preserve conversation state
- avoid leaking orchestration

---

# Security Requirements

## Mandatory

1. Hidden tools inaccessible to clients
2. Memory IDs scoped per conversation
3. No arbitrary memory traversal
4. Provider isolation
5. Transcript encryption at rest

---

# Observability

System SHOULD expose:

```
compression_ratio
memory_expansion_rate
average_token_savings
summary_hit_rate
provider_latency
rehydration_frequency
```

---

# Recommended Initial Stack

## Language

TypeScript

---

## Runtime

Node.js

---

## HTTP Layer

Fastify

---

## Database

PostgreSQL

---

## Queue

BullMQ or Temporal

---

## Embeddings

Provider-agnostic abstraction

---

## Vector Store

pgvector or Qdrant

---

# MVP Scope

## Phase 1

1. Chat completions compatibility
2. Transcript persistence
3. Simple summarization
4. remember() support
5. Hidden reinference loop
6. Token budgeting
7. Streaming passthrough

---

## Phase 2

1. Recursive summaries
2. search_memory()
3. Embedding retrieval
4. Responses API compatibility
5. Multi-provider routing
6. Semantic ranking

---

## Phase 3

1. Hierarchical memory DAG
2. Adaptive compression policies
3. Attention budgeting
4. Cross-session persistent memory
5. Predictive prefetch expansion
6. KV-cache-aware provider routing

---

# Critical Architectural Principle

The middleware MUST treat:

- raw transcript
- summaries
- retrieval artifacts
- provider prompts

as separate layers.

Provider prompts are:

- compiled execution artifacts

NOT:

- canonical conversational state.

That distinction is foundational to the architecture.

---

# Additional Hidden Middleware Tools

Below is a refined, implementation-oriented extension of the toolset. The focus is on turning the system from a simple "memory expander" into a controllable memory runtime with governance, inspection, and deterministic behavior.

---

# Core Memory Control Tools

## `compress_memory`

Explicitly compresses a span or region.

```json
{
  "name": "compress_memory",
  "parameters": {
    "scope_id": "string",
    "level": "light | medium | aggressive"
  }
}
```

Purpose:
- Gives deterministic control over summarization quality
- Prevents over-aggressive automatic compression
- Allows iterative refinement of summaries

---

## `expand_memory_range`

Rehydrates a contiguous region of transcript history.

```json
{
  "name": "expand_memory_range",
  "parameters": {
    "start_span": "string",
    "end_span": "string"
  }
}
```

Purpose:
- Enables range-based recovery instead of single-node recall
- Matches how reasoning actually spans time
- Reduces reliance on brittle IDs

---

## `pin_memory`

Marks memory as high-priority and non-compressible.

```json
{
  "name": "pin_memory",
  "parameters": {
    "memory_id": "string",
    "reason": "string"
  }
}
```

Purpose:
- Protects critical facts, user preferences, and long-lived state
- Prevents summary drift from overwriting important information

---

## `unpin_memory`

Removes protection from previously pinned memory.

```json
{
  "name": "unpin_memory",
  "parameters": {
    "memory_id": "string"
  }
}
```

Purpose:
- Prevents indefinite memory bloat
- Allows lifecycle management of long-term state

---

# Memory Graph & Reasoning Tools

## `query_memory_graph`

Graph-aware retrieval across memory relationships.

```json
{
  "name": "query_memory_graph",
  "parameters": {
    "query": "string",
    "depth": 1
  }
}
```

Purpose:
- Enables traversal of related memory nodes
- Supports reasoning over dependencies between episodes
- Moves beyond flat semantic search

---

## `merge_memories`

Consolidates overlapping or redundant memory nodes.

```json
{
  "name": "merge_memories",
  "parameters": {
    "memory_ids": ["string"]
  }
}
```

Purpose:
- Reduces fragmentation across long sessions
- Improves compression efficiency
- Supports hierarchical abstraction building

---

# Context Governance Tools

## `budget_context`

Controls how context is assembled for inference.

```json
{
  "name": "budget_context",
  "parameters": {
    "strategy": "expand_recent | preserve_old | balanced | task_focus"
  }
}
```

Purpose:
- Lets model influence token allocation strategy
- Prevents uniform context policies across all tasks

---

## `set_memory_policy`

Adjusts global memory behavior dynamically.

```json
{
  "name": "set_memory_policy",
  "parameters": {
    "compression_rate": "low | medium | high",
    "recency_bias": "number",
    "retention_priority": ["string"]
  }
}
```

Purpose:
- Makes memory behavior tunable per session or agent
- Enables adaptive compression strategies

---

# Debugging & Transparency Tools

## `explain_memory_state`

Returns reasoning about memory transformations.

```json
{
  "name": "explain_memory_state",
  "parameters": {
    "memory_id": "optional string"
  }
}
```

Purpose:
- Explains why compression or expansion occurred
- Shows what was lost or retained
- Critical for debugging and system trust

---

## `simulate_expansion_cost`

Estimates cost of expanding a memory region.

```json
{
  "name": "simulate_expansion_cost",
  "parameters": {
    "memory_id": "string"
  }
}
```

Purpose:
- Prevents expensive or unnecessary rehydration
- Enables pre-expansion planning

---

# Lifecycle & Event Structuring Tools

## `mark_event`

Tags significant conversational events.

```json
{
  "name": "mark_event",
  "parameters": {
    "type": "decision | fact | task | correction",
    "content": "string"
  }
}
```

Purpose:
- Builds structured episodic memory
- Improves downstream compression quality
- Enables event-driven memory reconstruction

---

# Critical Missing Primitive (Strongly Recommended)

## `rebuild_context_window`

Forces full regeneration of working context.

```json
{
  "name": "rebuild_context_window",
  "parameters": {
    "focus": "topic | task | span_id"
  }
}
```

Purpose:
- Acts as cache invalidation + reconstruction
- Fixes drift from bad summaries
- Ensures consistency after long sessions

---

# Minimal Viable Tool Set (Opinionated)

If building an MVP, the highest leverage subset is:

- `remember`
- `search_memory`
- `expand_memory_range`
- `pin_memory`
- `explain_memory_state`

This set provides:
- retrieval
- deterministic expansion
- stability control
- introspection
- safety against compression loss

---

# Architectural Insight

These tools collectively shift the system from:

> "summarized chat history"

to:

> "governed, addressable memory runtime"

The key upgrade is not compression itself, but **controllability and reversibility of memory state transitions**.
