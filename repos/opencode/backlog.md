# OpenCode — Backlog

## Overview

OpenCode AI coding agent server. Provides autonomous coding capabilities via web UI and API.

## Status

- **Completion**: 0/0 deliverables (deployed, no backlog tracked)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-24

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Deployed as container service, port 4009 (auto-allocated), slot b
- Privileged container with host filesystem mount
- Uses OpenCode config from /srv/agent-stack/config/opencode/
- Exposed at opencode.ffilt.us via Cloudflare tunnel
- OTEL-instrumented
- Systemd service `code` also runs OpenCode serve on host
