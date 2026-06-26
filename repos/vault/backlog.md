# Vault — Backlog

## Overview

Encrypted secrets vault for the agent stack. AES-256-GCM encryption with REST API for secret CRUD. Used by other services to resolve secrets at runtime.

## Status

- **Completion**: 0/0 deliverables (deployed, no backlog tracked)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-24

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Deployed as container service, port 4006 (auto-allocated), slot b
- Exposed at vault.ffilt.us via Cloudflare tunnel
- Persistent data volume: vault-data:/data
- Node.js server with AES-256-GCM encryption
- OTEL-instrumented
