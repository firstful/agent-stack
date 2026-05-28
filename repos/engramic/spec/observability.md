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

# Token & Cost Visibility

## Problem

Currently, the `usage` field from provider responses (prompt_tokens, completion_tokens, total_tokens) is parsed in the `OpenAIProvider.chat()` path but **never persisted, aggregated, or exposed**. The streaming path ignores it entirely. The `/metrics` endpoint is a stub with hardcoded zeros. There is zero cost tracking.

## Design

Introduce a **UsageTracking** layer that captures actual provider-reported usage per request, persists it, computes cost from a pricing model, and exposes it via API and OTel.

---

### UsageRecord

```ts
interface UsageRecord {
  id: string
  userId: string
  conversationId: string
  model: string
  providerLabel: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  createdAt: number
}
```

---

### PricingEntry

```ts
interface PricingEntry {
  modelPrefix: string
  inputPer1K: number
  outputPer1K: number
}
```

---

### UsageSummary

```ts
interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCost: number
  requestCount: number
  byModel: Record<string, { requests: number; promptTokens: number; completionTokens: number; cost: number }>
}
```

---

### Pricing Model

Hardcoded defaults for known providers, extensible via config/env:

| Model Prefix | Input $/1K | Output $/1K |
|-------------|-----------|------------|
| gpt-4o | 0.0025 | 0.01 |
| gpt-4o-mini | 0.00015 | 0.0006 |
| gpt-4 | 0.03 | 0.06 |
| gpt-3.5 | 0.001 | 0.002 |
| claude-3-opus | 0.015 | 0.075 |
| claude-3-sonnet | 0.003 | 0.015 |
| claude-3-haiku | 0.00025 | 0.00125 |

Cost = `(promptTokens / 1000) * inputPer1K + (completionTokens / 1000) * outputPer1K`

---

### Usage Store Interface

```ts
interface IUsageStore {
  record(usage: UsageRecord): Promise<void>
  getByUser(userId: string, since?: number): Promise<UsageRecord[]>
  getByConversation(convId: string): Promise<UsageRecord[]>
  getSummary(userId?: string, since?: number): Promise<UsageSummary>
  getGlobalSummary(since?: number): Promise<UsageSummary>
  pruneOlderThan(timestamp: number): Promise<number>
}
```

---

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_label TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost REAL NOT NULL,
  created_at BIGINT NOT NULL
);
```

---

### Streaming Usage Capture

The OpenAI streaming API sends a final `usage` data frame before `[DONE]`. The `ProviderStreamEvent` type gains a `usage` event type. The streaming handler captures it and creates a `UsageRecord`.

---

### Hidden Tool / Reinference Tagging

Reinference calls from hidden tools produce usage records tagged with `reinference: true`. This allows separating visible cost from middleware overhead cost, and per-tool-type breakdowns.

---

### API Endpoints

- **`GET /metrics`** — populated with real data (total tokens, cost, compression stats, latency)
- **`GET /v1/usage`** — per-account summary (prompt/completion tokens, cost, by-model breakdown)
- **`GET /v1/usage/records`** — raw usage records per account (for dashboards)

---

### OpenTelemetry

Emit counters for prompt_tokens, completion_tokens, cost_usd, and requests, tagged with model and user, flowing through the existing otel-collector to Grafana.

---

### Retention

Usage logs retained for 90 days by default (`ENGRA_USAGE_RETENTION_DAYS`). Pruning on startup + every 6 hours. Data scoped per-user via RLS (PostgreSQL) or file-per-user (file store).
