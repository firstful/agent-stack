# Agent Stack Root — Backlog

## Overview

Top-level meta-backlog for the Agent Stack monorepo at `/srv/agent-stack`. Tracks cross-cutting infrastructure work, documentation, and shared operational items.

## Status

- **Completion**: 2/6 deliverables done
- **Phase/Stage**: Active maintenance — infra refinements and engramic embeddings integration
- **Last updated**: 2026-06-29

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
- [ ] Split `infra/controller.ts` (931 lines) — extract MCP tools into `lib/mcp-tools.ts` and handler registrations into `lib/handlers.ts`

## Open Questions / Blockers

- [ ] Controller.ts suggested split is high-value but not urgent — recommended for next maintenance round
- [ ] No root-level CI/CD pipeline defined beyond the controller reconciliation loop

## Notes

- Most infra work tracked in individual repos; this file covers cross-cutting items only
- Root todos.md is intentionally small — repo-specific work lives in repos/<name>/
- See per-repo backlogs for detailed deliverable tracking
