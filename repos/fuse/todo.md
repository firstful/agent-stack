# Fuse — Backlog

## Overview

All-in-one AI-native communication platform unifying email, instant messaging, voice/video calls, meetings, and document collaboration. Started as a drop-in SMTP replacement with progressive federation. Pre-alpha — spec and architecture defined, no implementation started.

## Status

- **Completion**: 5/44 deliverables done (infrastructure only; all application items actionable)
- **Phase/Stage**: Pre-implementation — specs complete for v1 (SMTP), v1b (Shared Mailboxes), v2 (Federation), architecture docs for v3-v6
- **Last updated**: 2026-06-05

## Deliverables

### Infrastructure (5/8 complete)
- [x] Controller `agent-stack.json` definition exists
- [x] Postgres sidecar (db) running
- [x] Maddy sidecar defined in config
- [x] MinIO sidecar defined in config
- [ ] **Controller image pull error** — `maddyproject/maddy:latest` wrong image ref. Fix to `foxcpp/maddy:latest`
- [x] Agent-stack.json secrets structure defined
- [ ] **Secrets management** — Move `SESSION_SECRET`, `JWT_SECRET` from agent-stack.json env vars into vault, reference via `secrets: [...]`
- [ ] **OAuth credentials** — Set `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID` etc. in vault or env

### v1 — SMTP Gateway (0/8 complete)
- [ ] SMTP server implementation (based on Maddy `foxcpp/maddy`)
- [ ] Fuse ESMTP upgrade handshake (EHLO keyword or SRV record)
- [ ] Transport upgrade negotiation (`STARTFUSE`)
- [ ] Rich data structure delivery (reactions, threads, read receipts, rich text)
- [ ] Web UI for email visualization (orange border, "EXTERNAL EMAIL" badge)
- [ ] Export tool for data portability
- [ ] Maddy config hardening (Postgres storage, MX checking, rate limiting)
- [ ] DKIM signing — generate key pair, add DNS TXT record for `fuse.ffilt.us`

### v1b — Shared Mailboxes (0/6 complete)
- [ ] Team identity type (`shared`) — multi-user backing
- [ ] Cross-modality identity (email, chat, meetings, voice, docs)
- [ ] Internal notes on emails
- [ ] Task creation from email
- [ ] AI drafts for shared mailbox
- [ ] Canned responses + doc attachments

### v2 — Federation (0/6 complete)
- [ ] Domain trust & admin approval system
- [ ] Cross-org SMTP discovery + upgrade
- [ ] Webhook delivery with public key crypto (Ed25519 sign + encrypt)
- [ ] Cross-org messaging & shared channels
- [ ] Cross-org shared mailboxes
- [ ] Exponential backoff delivery queue

### v3 — Calendar & Meetings (0/4 complete)
- [ ] Scheduling engine
- [ ] CalDAV sync
- [ ] Video meetings
- [ ] RSVP handling

### v4 — Instant Messaging & Channels (0/6 complete)
- [ ] Discord-like chat channels
- [ ] Threads
- [ ] Reactions
- [ ] Presence
- [ ] Real-time typing indicators
- [ ] Channel categories

### v5 — Voice/Video Channels (0/4 complete)
- [ ] Persistent open voice channels
- [ ] Screen sharing
- [ ] Push-to-talk
- [ ] WebRTC audio bridge

### v6 — Document Store (0/4 complete)
- [ ] Notion/Confluence-like docs
- [ ] Block-based editor
- [ ] Real-time coauthoring (Yjs)
- [ ] Templates

### DNS & Email Infrastructure (0/4 complete)
- [ ] **MX record** — Point MX for `fuse.ffilt.us` at mail server
- [ ] **SPF record** — Publish SPF TXT record
- [ ] **DKIM record** — Publish DKIM public key TXT record
- [ ] **DMARC record** — Publish DMARC policy

### Data & Operations (0/3 complete)
- [ ] **Database backups** — Backup strategy for fuse-pgdata, fuse-minio-data, fuse-maddy-data volumes
- [ ] **Monitoring** — Health checks and uptime monitoring for fuse + sidecars
- [ ] **Log shipping** — Structured log aggregation from container logs

## Open Questions / Blockers

- [ ] **BLOCKING**: `maddyproject/maddy:latest` image does not exist; must change to `foxcpp/maddy:latest` in `agent-stack.json` before fuse can deploy
- [ ] **BLOCKING**: Cross-org E2EE scope — decide whether E2EE across Fuse instances is in v2 scope
- [ ] **BLOCKING**: Device lifecycle RECOVER scope — broadcast leave to all groups or per-group?
- [ ] **Runtime resource limits** — Controller lacks runtime `podman run` flags (`--memory`, `--cpus`)
- [ ] **Sidecar health checks** — No mechanism for testing postgres/minio/maddy readiness before fuse starts
- [ ] **Mobile strategy** — PWA vs React Native vs Flutter decision
- [ ] **Data residency** — GDPR compliance for cross-org data
- [ ] **File storage architecture** — Max attachment size, S3 vs local FS
- [ ] **Archiving/Compliance** — Legal hold, export, super admin
- [ ] **E2EE + outbound SMTP** — `/email` forwarding from E2EE groups
- [ ] **Inbound SMTP plaintext window** — Mitigation for plaintext exposure
- [ ] **Rate limits / Anti-spam** — DNSBL, DKIM/DMARC enforcement
- [ ] **Billing / Pricing model**
- [ ] **Plugin/Extension API**
- [ ] **Bridges** — Slack, Discord, Teams
- [ ] **Offline support** — PWA service worker, full offline sync

## Notes

- All sidecar containers defined in agent-stack.json format
- Fuse is currently 100% spec-phase except for sidecar infrastructure
- Running: Postgres DB sidecar only. Maddy, MinIO, and main fuse containers all down
- Controller blocks on maddy image pull every reconcile cycle
- The `maddy--maddy` sidecar crashes on start (code 1) due to maddy.conf configuration issue