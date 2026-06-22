# Files — Backlog

## Overview

Simple file hosting service for `file.ffilt.us`. Serves files from `/srv/files/` with proper Content-Type headers, directory browsing, and path traversal protection. Built on Node.js built-in `http` module with zero external dependencies. Systemd-managed.

## Status

- **Completion**: 6/8 deliverables done
- **Phase/Stage**: Active — deployed, initial release complete, features pending
- **Last updated**: 2026-06-2115

## Deliverables

### Initial Release (6/6 complete)
- [x] Create Node.js file server with proper MIME types
- [x] Serve HTML to render in browser (not download)
- [x] Directory browsing with pretty index pages
- [x] Path traversal protection
- [x] Systemd service unit (`agent-stack-files.service`)
- [x] Register with agent-stack + slot-proxy routing

### Phase 2 — Enhancements (0/2 complete)
- [ ] Upload endpoint (`POST /upload`)
- [ ] File size limits enforcement

## Open Questions / Blockers

- None.

## Notes

- Deployed as systemd service at port 3650, exposed at `file.ffilt.us`
- Routes through slot-proxy by Host header
- Serves from `/srv/files/` on host filesystem
- No authentication on current read-only deployment
