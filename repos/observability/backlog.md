# Observability — Backlog

## Overview

Observability stack for the agent stack — Grafana dashboard, OpenTelemetry collector, and Quickwit log search. Central monitoring infrastructure for all other services.

## Status

- **Completion**: 0/0 deliverables (deployed, no backlog tracked)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-15

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Deployed as container service, port 4003 (auto-allocated), slot a
- Sidecars: otel-collector (OpenTelemetry Collector contrib), quickwit (log search engine)
- Exposed at observability.ffilt.us via Cloudflare tunnel
- Grafana UI served from main container on port 7280
- Log collector agent running inside container (log-collector/ directory)
