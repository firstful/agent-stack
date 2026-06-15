# Agent Stack — AI Assistant Guide

This file helps AI agents (and humans) navigate the agent-stack project efficiently. It explains what things mean, where to find them, and how to search.

## Quick Navigation

| Topic | File / Directory |
|-------|-----------------|
| Architecture overview | [docs/architecture.md](docs/architecture.md) |
| Change detection (rebuild triggers) | [docs/change-detection.md](docs/change-detection.md) |
| Service discovery env vars | [docs/service-discovery.md](docs/service-discovery.md) |
| OpenTelemetry / observability | [docs/observability.md](docs/observability.md) |
| Cloudflare Access tokens | [docs/cloudflare-access.md](docs/cloudflare-access.md) |
| API endpoints reference | [config/wiki/agent-stack-endpoints.md](config/wiki/agent-stack-endpoints.md) |
| Slot swap / zero-downtime plan | [config/wiki/slot-swap-plan.md](config/wiki/slot-swap-plan.md) |
| Controller source | [infra/controller.ts](infra/controller.ts) |
| Reconcile worker | [infra/reconcile-worker.ts](infra/reconcile-worker.ts) |
| Library modules | [infra/lib/](infra/lib/) |
| Infra developer guide | [infra/README.md](infra/README.md) |
| Controller test suite | `npm test` in [infra/](infra/) |
| Runtime state (auto-generated) | [runtime/services.json](runtime/services.json) |
| Personal blog (standalone repo) | [/srv/personal-blog](https://github.com/reedsutliff/personal-blog) |
| TODO list | [todos.md](todos.md) |

## Directory Layout & What Things Mean

```
/srv/agent-stack/
├── AGENTS.md              ← This file — AI assistant guide
├── docs/                  ← Architecture docs (change detection, service discovery, etc.)
├── infra/                 ← Controller code + systemd unit
│   ├── controller.ts      ← Main HTTP server + reconciliation loop entry point
│   ├── reconcile-worker.ts← Worker thread that does the actual reconciliation
│   ├── generate-openapi.ts← Standalone script to emit OpenAPI spec JSON
│   ├── lib/               ← All helper modules:
│   │   ├── config.ts      ← Paths, constants, slot helpers
│   │   ├── services.ts    ← Loading desired state, hashing, git clone management
│   │   ├── reconcile.ts   ← Container lifecycle (build, deploy, slot swap)
│   │   ├── podman.ts      ← Podman CLI wrappers (build, run, inspect, network)
│   │   ├── cloudflared.ts ← Cloudflare tunnel config generation
│   │   ├── runtime.ts     ← Writing runtime/services.json state
│   │   ├── sidecar.ts     ← Sidecar container lifecycle
│   │   ├── systemd.ts     ← Systemd unit management (create, remove, start)
│   │   ├── routes.ts      ← Declarative REST API route registry + OpenAPI spec
│   │   ├── perf.ts        ← Performance metrics collection & history
│   │   └── types.ts       ← TypeScript interfaces (Service, ContainerConfig, etc.)
│   ├── *.test.ts          ← Tests (run via `npm test` or `npm run test:all`)
│   └── package.json       ← Dependencies (express, tsx, typescript)
├── desired/               ← JSON configs for **systemd-managed** services only
│   ├── cockpit.json       → Cockpit web console
│   ├── shellular.json     → Shell session recorder
│   ├── code.json          → OpenCode serve
│   ├── hermes.json        → Hermes dashboard
│   └── hermes-gateway.json→ Hermes gateway
├── repos/                 ← Git repos for **container-managed** services
│   ├── <service-name>/    ← Each subdirectory has its own code
│   │   ├── agent-stack.json       ← Primary service config (port, env, volumes, sidecars, expose)
│   │   ├── agent-stack.*.json     ← Additional services sharing the same repo (e.g. agent-stack.worker.json)
│   │   ├── Dockerfile / Containerfile ← Container build definition
│   │   └── ... source code ...
│   └── names.md           ← Repo name → display name mapping
├── config/                ← Per-service config volumes mounted into containers
│   ├── opencode/          → OpenCode config (opencode.json + AGENTS.md)
│   ├── observability/     → Grafana datasources, Tempo config, OTEL config
│   ├── wiki/              → API docs, OpenAPI spec, slot swap plan
│   └── groupthink/        → Groupthink config (shared config volume)
├── runtime/               ← Auto-generated runtime state (don't edit manually)
│   ├── services.json      ← Current state of all services (port, slot, running)
│   └── perf-history.json  ← Performance snapshot history
├── state/                 ← State tracking (routes.json currently empty)
├── mcp-shim/              ← Lightweight MCP shim for tool forwarding
├── journal.txt            ← Project journal (151KB, extensive history)
└── todos.md               ← Current task list
```

## Key Concepts

### Two Types of Services

| | Container Services | Systemd Services |
|---|---|---|
| **Config location** | `repos/<name>/agent-stack.json` | `desired/<name>.json` |
| **Runtime** | Podman container on `stack-net` | Systemd unit (`agent-stack-<name>.service`) |
| **Networking** | Container DNS on `stack-net` | `host.containers.internal` from other containers |
| **Lifecycle** | Managed by reconcile-worker | Managed by systemd |
| **When to use** | Most services (isolated, portable) | Host-level services (cockpit, hermes, code) |

### Service Naming
- The **service name** (from `agent-stack.json` name field) may differ from the **repo folder name** (e.g. repo `marp-editor` → service `techdeck`)
- Container names follow: `<servicename>`, `<servicename>--a`, `<servicename>--b` (slots), or `<servicename>--<sidecar>` (sidecars)
- Systemd unit names follow: `agent-stack-<servicename>.service`
- Repo → display name mapping at [repos/names.md](repos/names.md)

### Slot Swap (Zero-Downtime Deployment)
- Each container service gets two slots: `--a` and `--b`
- The active slot is tracked in `/tmp/stack.<name>.slot`
- On a new build: idle slot gets the new image, health-checked (30s timeout), then traffic swaps
- Old slot is removed after successful swap
- Custom health check path configurable via `container.healthCheck.path`

### Change Detection & Rebuild Triggers
- **Config hash**: MD5 of `agent-stack.json` contents. **Any edit triggers a rebuild immediately.**
- **Repo hash**: For repos inside the monorepo, uses `git log -1 --format=%H` for the subdirectory. **Only triggers a rebuild after `git commit`.** Uncommitted changes are ignored.
- **Skip-build**: Commit messages containing `[stack skip-build]` defer the rebuild so the agent can make multiple commits without triggering a build per commit.
- **.stackignore**: Files matching gitignore-style patterns are excluded from the content hash, so trivial changes (docs, config metadata) don't trigger rebuilds.
- **Fallback**: If git isn't available, uses recursive MD5 of all files in the repo directory.
- Combined hash: `md5(configHash + repoHash)` → stored in `/tmp/stack.<name>.hash`

### Deploy Strategies
- **blue-green** (default): Two slots (`--a`, `--b`) for zero-downtime swaps. On content change, the idle slot gets the new image, health-checked, then traffic swaps.
- **recreate**: Single container stopped and recreated. Simpler but incurs downtime during the swap. Good for non-critical or stateful services.
- **Queue mode** (`strategy: { type: "blue-green", queue: true }`): Commits are queued and processed one per reconciliation cycle, preventing build storms from rapid commits.
- **Canary** (`strategy: { type: "blue-green", canary: { ... } }`): After a successful build, routes a fraction of live traffic to the new slot and observes 5xx error rates before promoting. Requires all sidecars to be marked `canarySafe: true`.
- **Hard swap** (`[stack hard-swap]` commit message): Skips the canary observation window, promoting immediately. Useful for emergency rollouts or changes already validated elsewhere.

## How to Search This Repo

### Finding service configs
- `agent-stack.json` — search across all repos: `search_files('agent-stack.json', target='files')`
- Desired configs live in `desired/` directory
- Service config format: `repos/*/agent-stack.json` for containers, `desired/<name>.json` for systemd

### Finding running containers
- `sudo -u reeds podman ps` — must use rootless podman as user `reeds`
- Or check `runtime/services.json` for the runtime state snapshot

### Finding controller code
- Core: `infra/controller.ts` (HTTP server, route dispatch)
- Reconciliation: `infra/reconcile-worker.ts` (the actual orchestrator)
- Container ops: `infra/lib/reconcile.ts` (build, deploy, slot swap)
- Podman commands: `infra/lib/podman.ts` (all shell wrappers)
- Service definitions: `infra/lib/services.ts` (loader, hashing, cloning)
- Route definitions: `infra/lib/routes.ts` (declarative API route table + OpenAPI)

### Finding infrastructure configs
- Observability (Grafana, Tempo, OTEL): `config/observability/`
- OpenCode: `config/opencode/`
- API docs + endpoint reference: `config/wiki/`
- Controller test suite: `infra/*.test.ts`

### Finding documentation
- Primary docs in `docs/` (architecture, change detection, service discovery, observability, cloudflare access)
- OpenAPI spec generated from route registry at `/api/openapi.json`
- Slot swap plan at `config/wiki/slot-swap-plan.md`

## Common Operations

| Operation | How To |
|-----------|--------|
| Check controller health | `curl http://localhost/api/status` (from host) |
| List running containers | `sudo -u reeds podman ps` |
| View controller logs | `sudo journalctl -u agent-stack -f` (systemd) or `tail -f infra/controller.log` |
| View container logs | `sudo -u reeds podman logs <container>` or via API: `GET /api/logs/<name>` |
| Restart a container service | API: `POST /api/services/<name>/restart` |
| Rebuild a container | API: `POST /api/services/<name>/rebuild` (deletes hash marker, triggering rebuild on next reconcile) |
| Trigger reconciliation | API: `POST /api/reconcile` |
| Run controller tests | `cd infra && npm test` |
| Run all tests | `cd infra && npm run test:all` |
| Typecheck | `cd infra && npm run typecheck` |
| Add a new service | Create `repos/<name>/` with Dockerfile + `agent-stack.json`, controller auto-detects within 5s |
| Access *.ffilt.us programmatically | Use CF Access service token headers from docs/cloudflare-access.md |

## Pitfalls & Gotchas

- **Don't run controller.ts manually** — the systemd service handles production. A second instance causes port conflicts and race conditions.
- **Rootless podman**: Always use `sudo -u reeds podman ...` from a root shell. Running `podman` as root shows a separate rootful instance (empty).
- **Uncommitted changes don't trigger rebuilds** in git-aware mode. If you're testing and nothing happens, check if you committed.
- **Auto-port allocation** uses range 4000-4999. If you hit port exhaustion, check `getUsedHostPorts()`.
- **Build backoff**: Failed builds get exponential backoff (doubles each failure). First failure waits 5 cycles (25s). May appear stuck for a while.
- **sed/awk/grep/cat on this repo**: use the AI's `patch`, `read_file`, `search_files` tools instead — they're faster and respect gitignore patterns.
- **Secrets** are resolved from the vault service at runtime via `services.ts:resolveSecrets()`. The vault must be running for services with `secrets: [...]` in their config.
- **Controller runs with `CAP_NET_BIND_SERVICE`** so it can bind to port 80 as non-root user `reeds`.

## API Quick Reference (port 80 on host)

Full OpenAPI spec at `http://localhost/api/openapi.json`.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/status | Controller health + service states |
| GET | /api/services | List all services |
| POST | /api/services | Create a new service |
| GET | /api/services/:name | Get service status |
| PUT | /api/services/:name | Update service config |
| DELETE | /api/services/:name | Delete a service |
| POST | /api/services/:name/start/stop/restart/rebuild | Service lifecycle |
| POST | /api/reconcile | Force reconciliation |
| GET | /api/logs/:name | Get container logs |
| POST | /api/logs/analytics | Multi-source log aggregation |
| GET | /api/perf | Performance history |
| GET | /ping | Simple health check |
| POST | /sudo | Run sudo command (auth required) |
