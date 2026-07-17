# Agent Stack Root — Backlog

## Overview

Top-level meta-backlog for the Agent Stack monorepo at `/srv/agent-stack`. Tracks cross-cutting infrastructure work, documentation, and shared operational items.

## Status

- **Completion**: 3/8 deliverables done
- **Phase/Stage**: Active maintenance — infra refinements and operational hardening
- **Last updated**: 2026-07-13

## Deliverables

### Engramic Embeddings Integration (2/6 complete)
- [x] Revert infra/package.json + reinstall
- [x] Add `@xenova/transformers` to `repos/engramic/package.json`
- [ ] Update `repos/engramic/src/provider/embeddings.ts` — add `LocalEmbeddingsProvider` (Transformers.js, bge-small on CPU), `EmbeddingCache`, `createEmbeddingsProvider()` factory, `cosineSimilarity()` utility
- [ ] Update `repos/engramic/src/index.ts` to use the factory
- [ ] Add tests in `repos/engramic/test/`
- [ ] `npm install` in engramic, run typecheck + tests

### Infra Refinement (1/2 complete)
- [x] JSDoc and section comments added to 12 infra files
- [ ] Split `infra/controller.ts` (2082 lines) — extract MCP tools into `lib/mcp-tools.ts` and handler registrations into `lib/handlers.ts`

### Operational Hardening (0/3 complete)
- [ ] Persistent marker store — migrate hash/slot/queue/canary markers from `/tmp` to `/srv/agent-stack/runtime/markers/` to survive reboots
- [ ] Worker thread heartbeat watchdog — detect hung reconcile workers via IPC heartbeat
- [ ] Controller request metrics middleware — per-route latency/count/error tracking at `/api/metrics`

## Open Questions / Blockers

- [ ] Controller.ts split is high-value but needs dependency injection refactor first
- [ ] No root-level CI/CD pipeline defined beyond the controller reconciliation loop

## Notes

- jerrymapping (garden.ffilt.us) RESOLVED — gitlink mismatch fixed by clearing backoff state and repopulating clone directory. Container running on port 4001, slot a. Root cause (inner `.git` dir vs submodule file) still unresolved and could reoccur on clone regeneration.
- 1 commit in past 24h (auto-backup only) — no feature or config changes.
- Documentation discipline maintained: all new code arrives with JSDoc and section dividers
- Most infra work tracked in individual repos; this file covers cross-cutting items only
