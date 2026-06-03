# Engramic (SCVM) — Backlog

## Overview

Semantic Context Virtualization Middleware — a stateful middleware server that exposes an OpenAI-compatible API while transparently virtualizing conversational context. Currently in active development (Phase 2/3 maturity with Phase 4 Profile System underway).

## Status

- **Completion**: ~22/35 deliverables done (core engine complete, UI/polish items pending)
- **Phase/Stage**: Phase 2 (rich features) complete; Phase 3 (hierarchical memory) partial; Phase 4 (Profile System) in progress
- **Last updated**: 2026-05-29

## Specification Index

| Document | Description |
|----------|-------------|
| [Overview](spec/overview.md) | System overview, functional goals, and non-goals |
| [Architecture](spec/architecture.md) | High-level architecture diagram and primary concepts |
| [API](spec/api.md) | API compatibility (OpenAI-compatible endpoints) and internal canonical types |
| [Compression](spec/compression.md) | Compression lifecycle, triggers, and flow |
| [Tools](spec/tools.md) | Required and additional hidden middleware tools |
| [Tool Interception](spec/tool-interception.md) | Tool interception flow, recursive expansion, and hidden orchestration rules |
| [Context Engine](spec/context-engine.md) | Context assembly engine, token budgeting, and streaming architecture |
| [Provider](spec/provider.md) | Provider layer normalization, capability model, and memory ranking |
| [Persistence](spec/persistence.md) | Durability requirements and storage model recommendations |
| [Failure & Security](spec/failure-security.md) | Failure handling strategies and security requirements |
| [Observability](spec/observability.md) | Metrics, token & cost visibility, and OpenTelemetry integration |
| [Stack](spec/stack.md) | Recommended initial technology stack |
| [Roadmap](spec/roadmap.md) | MVP scope (Phase 1-3) and Phase 4 Profile System |
| [Principles](spec/principles.md) | Critical architectural principles and insights |

## Deliverables

### Phase 1 — Core Engine (7/7 complete)
- [x] Chat completions API compatibility
- [x] Transcript persistence
- [x] Simple summarization
- [x] `remember()` hidden tool support
- [x] Hidden reinference loop
- [x] Token budgeting
- [x] Streaming passthrough

### Phase 2 — Rich Features (5/6 complete)
- [x] Recursive summaries
- [x] `search_memory()` tool
- [x] Embedding retrieval (Transformers.js + PG vector)
- [ ] Responses API compatibility — **not yet implemented**
- [x] Multi-provider routing
- [x] Semantic ranking

### Phase 3 — Hierarchical Memory (1/6 complete)
- [ ] Hierarchical memory DAG
- [ ] Adaptive compression policies
- [x] Attention budgeting — (`budget_context.ts` exists)
- [ ] Cross-session persistent memory
- [x] Predictive prefetch expansion — (`predictive_prefetch.ts`, `prefetch_engine.ts`, 35 unit tests pass)
- [ ] KV-cache-aware provider routing

### Phase 4 — Profile System (5/6 complete)
- [x] Profile types added to types.ts, Account updated
- [x] Profile CRUD in IUserStore (JSON + Postgres)
- [x] Profile management endpoints (CRUD routes)
- [x] Profile-scoped inference (chat completions + models list)
- [x] Web UI for profile management — **done**
- [ ] Cloudflared tunnel config for profile-scoped URLs — **pending**

### Active Tools (12/12 implemented)
- [x] `remember()` — store memory
- [x] `search_memory()` — semantic search
- [x] `compress_memory()` — trigger compression
- [x] `expand_memory_range()` — rehydrate spans
- [x] `pin_memory()` / `unpin_memory()` — working set control
- [x] `merge_memories()` — combine nodes
- [x] `query_memory_graph()` — hierarchical queries
- [x] `set_memory_policy()` — compression strategy
- [x] `budget_context()` — token budget management
- [x] `explain_memory_state()` — introspection
- [x] `mark_event()` — event marking
- [x] `rebuild_context_window()` — full rebuild
- [x] `simulate_expansion_cost()` — cost estimation

### Documentation & Tests (3/6 complete)
- [x] README / setup instructions
- [x] 14 spec docs in spec/
- [x] Test framework (embedding tests, interception tests, e2e wizard tests)
- [ ] Auto-generated API reference
- [ ] Architecture diagram
- [ ] Contribution guide

## Open Questions / Blockers

- **Observability deployment failing** — grafana/postgres stack health check issue, not blocking engramic directly
- **No production backup strategy** for Postgres sidecar data
- **Roadmap:** Need to scope Phase 3 items against actual usage patterns before implementing

## Notes

- Running as container slot a on port 4005, exposed at engramic.ffilt.us
- Uses Postgres sidecar (running) for persistence
- All hidden middleware tools are operational
- Profile system e2e tests exist for both wizard flows (add-provider, add-profile)
