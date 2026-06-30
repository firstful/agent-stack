# Marketplace (Red Thread) — Backlog

## Overview

Red Thread Module Marketplace, deployed at red-thread.ffilt.us. Serves the module catalogue for downloadable story packs and engine bundles. Modules are versioned with shell-version compatibility constraints, distributed as zip archives. Systemd-managed service.

## Status

- **Completion**: 0/0 deliverables
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-29

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Systemd service, port 3652, exposed at red-thread.ffilt.us via Cloudflare tunnel
- Written as a single-file Node.js server (server.mjs, 544 lines)
- Endpoints: GET /api/catalogue, GET /api/modules/:id, GET /api/modules/:id/download, GET /api/modules/:id/version.json
- Module storage under MODULES_DIR/ with manifest.json + pre-bundled zip archives
