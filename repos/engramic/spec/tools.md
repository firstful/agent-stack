# Hidden Middleware Tools

## Tool Injection

The middleware injects hidden tools into provider requests.

These tools MUST NOT be visible to:

- client
- end user

---

## Required Hidden Tools

### remember()

Expands compressed memory regions.

Schema:

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

### search_memory()

Semantic lookup across compressed history.

Schema:

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

## Additional Hidden Middleware Tools

Below is a refined, implementation-oriented extension of the toolset. The focus is on turning the system from a simple "memory expander" into a controllable memory runtime with governance, inspection, and deterministic behavior.

---

## Core Memory Control Tools

### compress_memory

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

### expand_memory_range

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

### pin_memory

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

### unpin_memory

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

## Memory Graph & Reasoning Tools

### query_memory_graph

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

### merge_memories

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

## Context Governance Tools

### budget_context

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

### set_memory_policy

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

## Debugging & Transparency Tools

### explain_memory_state

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

### simulate_expansion_cost

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

## Lifecycle & Event Structuring Tools

### mark_event

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

## Critical Missing Primitive (Strongly Recommended)

### rebuild_context_window

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

## Minimal Viable Tool Set (Opinionated)

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
