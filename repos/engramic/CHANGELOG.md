# Engramic Changelog & Outstanding Tasks

> Generated from `main` branch, 23 commits ahead of `origin/main`. All recent work is from **May 25–27, 2026**.

---

## Recent Changes (Changelog)

### Service Bootstrap & Infrastructure
- **Created engramic service** with a working Containerfile (`npm ci → tsc → npm prune`)
- **Switched base image** from Alpine to `node:22-slim` (glibc) for ONNX Runtime compatibility, then simplified back to plain `node:22-slim`
- **Assigned explicit host port** (`4008`) to avoid collision with opencode on port 3000
- **Added DB migrations on startup** with idempotent `init.sql`

### Persistence Layer
- **Migrated all runtime state to PostgreSQL** with `pgvector` support
- **Added `PgMemoryStore`** — durable conversation storage with JSONB blobs
- **Added `PgVectorStore`** — semantic embedding storage backed by pgvector
- **Added `PgUserStore`** — account/provider/profile persistence with auto test-account creation
- **Added `PgUsageStore`** — cost and token usage logging with per-user scoping

### Memory & Embeddings
- **Added pluggable embeddings system** with two providers:
  - **Local**: Transformers.js + `bge-small-en-v1.5` via ONNX Runtime
  - **Remote**: OpenAI-compatible embedding API
- **Added `VectorStore`** with `save`/`load` and **semantic importance ranking** (`rankByImportance`)
- **Wired importance ranking into compression** to replace hardcoded `0.5` scores
- **Preserved system-prompt spans** from compression (they are now kept in working set)

### Context Engine
- **Implemented `ContextEngine.assemble()`** with token budgeting and four strategies:
  `balanced`, `expand_recent`, `preserve_old`, `task_focus`
- **Implemented `compressConversation()`** with heuristic triggers (token threshold, turn threshold, idle time)
- **Added span selection scoring** for compression targets

### Hidden Tool System
Implemented all 14 spec-defined hidden middleware tools:
- `remember()` — single-memory rehydration
- `search_memory()` — semantic (vector) + keyword fallback search
- `compress_memory()` — explicit compression scheduling
- `expand_memory_range()` — contiguous span rehydration
- `pin_memory` / `unpin_memory` — protect memories from compression
- `query_memory_graph` — graph-traversal across summary relationships
- `merge_memories` — consolidate overlapping handles
- `budget_context` — set assembly strategy
- `set_memory_policy` — tune compression rate, recency bias, retention
- `explain_memory_state` — introspection + token-impact reporting
- `simulate_expansion_cost` — cost estimation stub
- `mark_event` — tag conversational events (decision/fact/task/correction)
- `rebuild_context_window` — focused context regeneration

### Provider Management
- **Added provider management web UI** (Alpine.js) with:
  - Provider table (list, test connection, delete)
  - **5-step wizard** (`/add-provider`): type → connect → test → model selection → validation
  - Support for wildcard model selection (`*`)
  - Live chat validation step
- **`/test-provider`** endpoint — fetches models from any OpenAI-compatible endpoint
- **`/test-chat`** endpoint — validates a model with a live ping

### Profile System (Phase 4 — Partial)
- **Added `Profile` types** with role assignments (`execution`, `summarization`, `embedding`)
- **Added profile CRUD** to both `UserStore` and `PgUserStore`
- **Added profile endpoints**:
  - `POST/GET/PUT/DELETE /v1/profiles`
  - `POST /v1/profiles/:id/regenerate-token`
  - `GET /v1/:profileId/models`
  - `POST /v1/:profileId/chat/completions`
- **`/add-profile`** page for creating profiles via UI
- **Dashboard at root (`/`)** showing provider and profile tables

### Usage Tracking & Observability
- **Added `UsageRecord` / `UsageSummary`** types and pricing engine with hardcoded rates
- **Added `MetricsCollector`** tracking:
  - compression ratio, memory expansion rate, average token savings
  - summary hit rate, provider latency, rehydration frequency
- **Wired usage capture** into both streaming and non-streaming chat paths
- **`GET /metrics`** — live populated endpoint
- **`GET /v1/usage`** — per-account summary
- **`GET /v1/usage/records`** — raw record list
- **Automatic pruning** every 6 hours (`ENGRA_USAGE_RETENTION_DAYS`, default 90)

### Dashboard & Performance
- **Historical performance dashboard** with 5-minute recurring snapshots
- **Moved perf dashboard** into slot-proxy serving at `dash.ffilt.us/perf`
- **`/chats`** and **`/ui`** HTML endpoints for conversation inspection and admin dashboard

---

## Outstanding Tasks

### ~~🔴 Critical / Blocking~~ ✅ Completed

| # | Task | Status |
|---|------|--------|
| 1 | **Buffer streaming output until hidden orchestration completes** | ✅ Rewrote `handleStreaming` to buffer silently, execute tools, reinfer, then flush final stabilized content. Removed `handleHiddenTool`. |
| 2 | **Wire `summarization` and `embedding` profile roles** | ✅ Added `createProfileProviders()` in `provider-factory.ts`; wired all three roles into profile-scoped endpoint and `compressConversation`. |
| 3 | **Add OpenTelemetry tracing to engramic** | ✅ Created `tracing.ts` with NodeSDK + auto-instrumentations + OTLP exporter; wired into `main()`. |
| 4 | **Implement cross-session persistent memory** | ✅ Added `globalMemories` to `Account`, `getAccountMemories`/`addAccountMemory` to all store layers, `global_memories JSONB` column, global fallback in `executeRemember`/`executeSearch`, and post-compression save in `handleChatRequest`. |

### 🟡 High Priority

| # | Task | Why |
|---|------|-----|
| 5 | **~~Implement recursive summary DAG operations~~** | ✅ `compressConversation` now detects existing summaries on target spans and links new summaries as children. |
| 6 | **~~Make `compress_memory` tool actually compress~~** | ✅ `executeCompressMemory` is now async, accepts summarization provider, invokes it, creates `SummaryNode` + `MemoryHandle`, and wires DAG links. |
| 7 | **~~Implement `simulate_expansion_cost` with real token estimation~~** | ✅ Uses real `span.tokenCount`, `turnRange` spans, DAG parent summary costs, and per-message token averages with detailed recommendation. |
| 8 | **Add transcript encryption at rest** | Security spec requires it. Currently conversations are stored as plain JSONB. |
| 9 | **Add RLS / authorization to conversation reads** | Any token can access any conversation ID. `conversation_id` is passed by the client with no ownership check. |
| 10 | **Improve model auto-resolution** | The `"auto"` model logic only checks exact match or wildcard `*`. It should walk `modelPreferences` against the provider's actual fetched model list. |

### 🟢 Medium Priority (MVP Polish)

| # | Task | Why |
|---|------|-----|
| 11 | **Add Responses API compatibility** | Phase 2 spec item. Currently only chat completions is supported. |
| 12 | **Implement `set_memory_policy` persistence** | `MemoryPolicy` exists on `Conversation` but is not persisted as a first-class column; it lives inside the JSONB blob and is not queryable. |
| 13 | **Add `budget_context` influence to `ContextEngine`** | The tool stores the strategy on `conv.metadata`, but `assemble()` only reads `conv.metadata.budgetStrategy`. No UI or API exposes this dynamically per-request. |
| 14 | **Add provider capability detection** | `ProviderCapabilities` type exists but is never populated or used to gate tool injection (e.g., disable tools for providers that don't support them). |
| 15 | **Improve search_memory semantic relevance threshold** | Keyword fallback kicks in whenever vector store returns empty or low-score results. There is no configurable relevance cutoff. |
| 16 | **Add KV-cache-aware provider routing** | Phase 3 spec item. No provider state tracking or cache affinity logic exists. |
| 17 | **Add retry logic for hidden reinference failures** | Spec: *"retry provider call, preserve conversation state, avoid leaking orchestration"*. Only a basic try/catch with fallback text exists for `remember()`. |
| 18 | **Compress tool orchestration state** | `toolCalls` and `systemEvents` arrays grow unbounded per conversation. No pruning or compression. |

### 📝 Spec / Documentation
- `SPEC.md` was decomposed into 14 focused `spec/*.md` documents. The spec is current with the codebase, but **roadmap.md Phase 3 items are largely unimplemented**.
- No `TODO` or `FIXME` comments found in source — outstanding work lives in the spec/roadmap and architectural gaps above.

---

**Bottom line**: All 4 critical tasks and 3 high-priority tasks are complete. Streaming buffering, profile role resolution, cross-session memory, OTel tracing, DAG summary linking, the `compress_memory` tool, and `simulate_expansion_cost` are all implemented. Remaining work: encryption at rest, RLS, model auto-resolution, Responses API, and various polish items.
