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
