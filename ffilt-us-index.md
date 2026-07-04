# ffilt.us Subdomain Index

> **Purpose**: Master registry of all services hosted on *.ffilt.us via the agent-stack.
> **Source of truth**: `agent-stack.json` configs in `repos/<name>/` and `desired/<name>.json`.
> **Runtime state**: `/srv/agent-stack/runtime/services.json` (auto-generated, most current).
> **Controller**: `/srv/agent-stack/infra/controller.ts`.
> **Doc index**: `/srv/agent-stack/AGENTS.md`.

---

## Active Services (Public)

| Subdomain | Service Name | Repo / Config | Description |
|-----------|-------------|---------------|-------------|
| talaria.ffilt.us | Talaria | `repos/talaria/` | Voice PTT gateway for Hermes. Raw PCM WebSocket, faster-whisper STT, EdgeTTS. Blue-green. |
| blogpreview.ffilt.us | Personal Blog | `repos/personal-blog/` | Preview/staging of reedsutliff/personal-blog static site. Blue-green. |
| cockpit.ffilt.us | Cockpit | `desired/cockpit.json` | Linux server admin web console (systemd-managed). |
| code.ffilt.us | Code (OpenCode) | `desired/code.json` | OpenCode AI coding agent web UI (systemd-managed). |
| engramic.ffilt.us | Engramic | `repos/engramic/` | AI knowledge base / semantic memory with pgvector embeddings. Blue-green. Wildcard `*.engramic.ffilt.us`. |
| file.ffilt.us | File Server | `repos/files/` | Serves `/srv/files` directory. Also accessible at `files.ffilt.us`. |
| fuse.ffilt.us | Fuse | `repos/fuse/` | Self-hosted social media platform (Twitter-like). PostgreSQL, Maddy (email), MinIO (media) sidecars. Blue-green. |
| games.ffilt.us | Games | `repos/games/` | Web-based game server. Blue-green. |
| garden.ffilt.us | Jerry Mapping | `repos/jerrymapping/` | Garden/yard mapping application. Blue-green. |
| groceries.ffilt.us | Groceries | `repos/groceries/` | Grocery order dashboard — scrapes Amazon, Walmart, Kroger, Sam's Club, ALDI. Blue-green. Rate-limited. |
| groupthink.ffilt.us | Groupthink | `repos/groupthink/` | AI discussion/chat platform with LLM integration. PostgreSQL + Redis sidecars. Blue-green with canary deploys. |
| hermes.ffilt.us | Hermes Dashboard | `desired/hermes.json` | Hermes Agent web dashboard (systemd-managed). Wildcard `*.hermes.ffilt.us`. |
| install.ffilt.us | Install Server | `repos/install/` | Serves installation/media files from `/srv/files`. |
| kilocode.ffilt.us | Kilocode Web | `repos/kilocode-web/` | Code review platform. Auth.js with passkeys. Blue-green. |
| life.ffilt.us | AppFlowy | `repos/appflowy/` | Self-hosted workspace/project management (Notion-like). Docker Compose managed. |
| observability.ffilt.us | Observability | `repos/observability/` | Grafana dashboards + OpenTelemetry collector + Quickwit log storage. Blue-green. |
| opencode.ffilt.us | OpenCode | `repos/opencode/` | OpenCode AI coding agent (containerized). Privileged access. Blue-green. |
| red-thread.ffilt.us | Red Thread Marketplace | `repos/marketplace/` | Shopping marketplace for the narrative JRPG project. |
| techdeck.ffilt.us | TechDeck | `repos/marp-editor/` | Markdown presentation editor (Marp-based). Blue-green. DeepSeek LLM integration. |
| vault.ffilt.us | Vault | `repos/vault/` | Secret/credential storage service. REST API. Blue-green. |

## Active Services (Internal Only)

| Config | Service Name | Description |
|--------|-------------|-------------|
| `desired/hermes-gateway.json` | Hermes Gateway | Hermes Telegram/Discord gateway (systemd-managed, not exposed). |
| `desired/shellular.json` | Shellular | Shell session recorder (systemd-managed, not exposed). |
| `repos/engramic/agent-stack.static.json` | Engramic Static | Engramic read-only / static instance (container, not exposed). |

## Infrastructure

| Subdomain | Service | Description |
|-----------|---------|-------------|
| *.ffilt.us | slot-proxy | `repos/slot-proxy/` — Wildcard reverse proxy. Routes all *.ffilt.us traffic to correct internal service based on Host header. Reads `runtime/services.json`. |

## Planned / Not Deployed

| Service | Repo | Status |
|---------|------|--------|
| Gitea | `repos/gitea/` | Repo empty, not deployed. |
| Free LLM Router | *(no repo)* | Listed in `repos/names.md` but not present on disk. |
| OpenCode Admin | *(no repo)* | Listed in `repos/names.md` but not present on disk. |
| Dash | `repos/dash/` | Has Containerfile but no agent-stack.json — not wired up. |

## How to Use This Index

**For AI agents**: When a user mentions any `*.ffilt.us` subdomain, read this index to understand what service they're referring to. For deeper context, check the service's `agent-stack.json` config and any README in its repo directory.

**For humans**: This file lives at `/srv/agent-stack/ffilt-us-index.md`. The authoritative runtime state is at `/srv/agent-stack/runtime/services.json`.

---

## Related Documentation

| Document | Path | Purpose |
|----------|------|---------|
| Agent Stack Guide | `AGENTS.md` | AI assistant guide for the whole agent-stack |
| Architecture | `docs/architecture.md` | System architecture overview |
| Change Detection | `docs/change-detection.md` | How rebuilds are triggered |
| Cloudflare Access | `docs/cloudflare-access.md` | Service token auth for programmatic access |
| Observability | `docs/observability.md` | OpenTelemetry + Grafana + Quickwit |
| Service Discovery | `docs/service-discovery.md` | How services find each other via env vars |
| API Endpoints | `config/wiki/agent-stack-endpoints.md` | Full API endpoint reference |
| Slot Swap Plan | `config/wiki/slot-swap-plan.md` | Zero-downtime deployment strategy |
| Names Mapping | `repos/names.md` | Repo directory → display name mapping |
