# TechDeck (Marp Editor) — Backlog

## Overview

Marp-based slide deck editor and presentation tool, branded as TechDeck. Served at techdeck.ffilt.us. Deployed and operational.

## Status

- **Completion**: 0/0 deliverables (deployed, no backlog tracked)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-05-29

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Deployed as container service, port 4004 (auto-allocated), slot b
- Uses secrets from vault: IDP_GOOGLE_TECHDECK_CLIENT_ID, IDP_GOOGLE_TECHDECK_CLIENT_SECRET, LLM_DEEPSEEK_TECHDECK_API_KEY
- OTEL-instrumented
- Exposed at techdeck.ffilt.us via Cloudflare tunnel
- Service name in agent-stack.json: `techdeck`
