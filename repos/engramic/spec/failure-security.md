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
