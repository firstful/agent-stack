# Install Service — Backlog

## Overview

OTA update service for Android APKs, deployed at install.ffilt.us. Serves versioned APK files, handles update checks (GET /update?app=<id>&ver=<current>), redirects stable APK names to latest versioned files, and serves version.json manifests. Systemd-managed service.

## Status

- **Completion**: 0/0 deliverables
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-29

## Deliverables

No deliverables tracked in backlog.

## Open Questions / Blockers

None.

## Notes

- Systemd service, port 3651, exposed at install.ffilt.us via Cloudflare tunnel
- APK directory layout under FILES_DIR/apk/ with version.json + versioned APKs
- Written as a single-file Node.js server (server.mjs, 170 lines)
- Split from the general file server for focused APK delivery
