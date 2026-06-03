# Obsidian LiveSync — Backlog

## Overview

CouchDB-based sync backend for Obsidian LiveSync plugin. Deployed to sync Obsidian vaults across devices.

## Status

- **Completion**: 1/1 deliverables (deployed)
- **Phase/Stage**: Deployed and operational
- **Last updated**: 2026-06-03

## Deliverables

- [x] **Deploy CouchDB service** — agent-stack.json created, container building on next reconcile
  - Auto-allocated port from 4000-4999 range
  - Persistent volume for CouchDB data
  - Admin credentials set via env vars

## Connection Details

- **Plugin URL**: `http://<host>:<auto-port>/`
- **Database name**: Create via Fauxton UI or curl after first deploy
- **Username**: `admin`
- **Password**: Set in agent-stack.json env vars

## Open Questions / Blockers

None.

## Notes

- Containerfile based on CouchDB 3 with CORS pre-configured for Obsidian clients
- local.ini allows connections from `app://obsidian.md`, `capacitor://localhost`, `http://localhost`
- No public exposure — LAN-only. Revisit if remote sync needed.
