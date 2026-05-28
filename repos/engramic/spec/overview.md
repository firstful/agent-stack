# Overview

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

## Core Design Goals

### Functional Goals

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
