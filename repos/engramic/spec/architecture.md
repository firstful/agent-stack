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
