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

## Memory Ranking

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
