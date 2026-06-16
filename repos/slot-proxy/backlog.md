# Slot Proxy — Backlog

## Overview

Reverse proxy for zero-downtime slot swapping across all container services. Routes *.ffilt.us traffic to active service slots by reading runtime/services.json.

## Status

- **Completion**: 0/0 deliverables (deployed, no backlog tracked)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-15

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Deployed as container service, port 4008 (auto-allocated), slot b
- Routes at *.ffilt.us via Cloudflare tunnel (no_proxy mode)
- Reads runtime/services.json for current active slot mapping
- Written as a lightweight Node.js proxy (proxy.mjs)
- OTEL-instrumented
