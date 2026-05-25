# Fuse — Remaining Work

## Infrastructure

- [ ] **Controller is down** — `agent-stack.service` needs to be restarted on the host before fuse (or anything else) can deploy
- [ ] **Secrets management** — Move `SESSION_SECRET`, `JWT_SECRET` from `agent-stack.json` env vars into vault, reference via `secrets: ["SESSION_SECRET", "JWT_SECRET"]`
- [ ] **OAuth credentials** — Set `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, etc. in vault or env for social login
- [ ] **Runtime resource limits** — The controller only supports `build.podman_args`; no runtime `podman run` flags yet (would need a controller change for `--memory`, `--cpus` at runtime)
- [ ] **Health checks** — No pre-built mechanism for sidecar health checks; postgres/minio/maddy readiness is not verified before fuse starts

## Maddy (SMTP)

- [ ] **TLS certificates** — Maddy needs Let's Encrypt or similar for STARTTLS on outbound delivery
- [ ] **DKIM signing** — Generate DKIM key pair, add DNS TXT record for `fuse.ffilt.us`
- [ ] **Production config** — Current `maddy.conf` is minimal (sqlite3, no auth, mx_check off). Needs hardening: switch to Postgres storage, enable MX checking, add rate limiting
- [ ] **Postgres storage** — Wire Maddy to use the postgres sidecar instead of sqlite3

## DNS (for email)

- [ ] **MX record** — Point MX for `fuse.ffilt.us` at a mail server that can receive on port 25
- [ ] **SPF record** — Publish SPF TXT record authorizing the sending IP
- [ ] **DKIM record** — Publish DKIM public key TXT record
- [ ] **DMARC record** — Publish DMARC policy

## Data & Operations

- [ ] **Database backups** — No backup strategy for `fuse-pgdata`, `fuse-minio-data`, `fuse-maddy-data` volumes
- [ ] **Monitoring** — No health checks or uptime monitoring for the fuse service or its sidecars
- [ ] **Log shipping** — Container logs go to journald; no structured log aggregation
