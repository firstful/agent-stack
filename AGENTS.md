# Agent Stack

A lightweight container orchestration system using Podman, Cloudflare Tunnel, and a Node.js controller that reconciles desired state.

## Architecture

```
desired/*.json → controller.ts → podman containers + cloudflared tunnel
```

> **Note**: The `desired/` folder is **only for systemd-managed services** (like cockpit). For containerized services managed by the controller, configuration should be placed in each service's repository as `agent-stack.json`.

- **controller.ts** - Runs every 5 seconds via systemd (`agent-stack.service`), compares desired/ state with running containers, builds images, starts/stops containers, and regenerates cloudflared config. On each tick it spawns a **reconcile-worker.ts** as a child process to do the actual reconciliation work. **Do NOT run it manually** — the systemd service handles it automatically. Running a second instance directly will cause port conflicts and race conditions with the systemd-managed one. **Note: The AI assistant should not attempt to kill or restart the controller process directly.**
- **Podman** - Container runtime for running services
- **cloudflared** - Exposes services via Cloudflare Tunnel using ingress rules from service configs
- **systemd** - Runs controller as a service (`agent-stack.service`)

## Directory Structure

```
 /srv/agent-stack/
 ├── infra/               # Controller and dependencies
 │   ├── controller.ts    # Main reconciliation loop + HTTP/API server
 │   ├── reconcile-worker.ts  # Child process that performs reconciliation
 │   ├── lib/             # Modular helper libraries
 │   │   ├── config.ts
 │   │   ├── services.ts
 │   │   ├── podman.ts
 │   │   ├── cloudflared.ts
 │   │   ├── runtime.ts
 │   │   └── reconcile.ts
 │   ├── package.json
 │   └── agent-stack.service
 ├── desired/             # Service definitions (JSON files) - ONLY for systemd-managed services
 │   ├── cockpit.json
 │   └── shellular.json
 ├── repos/               # Git repositories for each service
 │   ├── <service-name>/
 │   │   ├── Dockerfile
 │   │   └── agent-stack.json   # Containerized service configuration
 ├── runtime/             # Runtime state (services.json)
 ├── config/              # Service-specific config volumes
 └── agent-stack.service  # systemd unit file (copy to /etc/systemd/system/)
 ```

## Service Configuration (desired/*.json)

```json
{
  "name": "service-name",
  "repo": "/srv/agent-stack/repos/service-name",
  "version": 1,
  "container": {
    "port": 3000,
    "env": { "KEY": "value" },
    "volumes": ["/host/path:/container/path"]
  },
  "expose": {
    "hostname": "service.example.com",
    "tunnel": "uuid-or-name",
    "enabled": true
  }
}
```

## Key Operations

| Command | Description |
|---------|-------------|
| `npx tsx controller.ts` | Run controller once (or as daemon with 5s interval) — **only for testing**; the systemd service handles production runs. Never leave a manual instance running — it will conflict. |
| `sudo systemctl status agent-stack` | Check if controller service is running |
| `sudo journalctl -u agent-stack -f` | Follow controller logs |
| `sudo -u reeds podman ps` | List running containers (controller runs as `reeds` with rootless podman) |
| `sudo -u reeds podman images` | List built images |
| `sudo -u reeds podman logs <container>` | View container logs |
| `curl -s http://localhost/api/status` | Check controller health |
| `sudo systemctl restart cloudflared` | Restart tunnel after config change |

> **Important**: The controller runs as user `reeds` using **rootless podman**. When inspecting containers or images from a root shell, always prefix podman commands with `sudo -u reeds`. Running `podman` as root shows a separate rootful instance which will appear empty.

## Adding a Service

1. Create `/srv/agent-stack/repos/<name>/` with a `Dockerfile`
2. Add `/srv/agent-stack/repos/<name>/agent-stack.json`
3. Controller auto-detects and reconciles within 5 seconds

## Change Detection

The controller determines whether a service's container needs a rebuild by computing a combined hash of:

1. **Config hash** — `md5` of `agent-stack.json` (or `desired/<name>.json`). Any edit to the config always triggers a rebuild.
2. **Repo hash** — a hash of all files in the service's repo directory, used to detect source/Dockerfile changes.

The combined hash is: `md5(configHash + repoHash)`. If this hash differs from the previous reconciliation, the controller rebuilds the image and recreates the container.

### Git-Aware Hashing

Since the entire `/srv/agent-stack/` tree is a git repository, the controller uses `git log -1 --format=%H -- repos/<service-name>/` to compute the repo hash. This means:

- **Uncommitted file edits do NOT trigger a rebuild.** The `git log` query returns the same commit hash until you `git commit`.
- **After committing**, the next reconciliation (within 5 seconds) detects the new commit hash and triggers a rebuild.
- **Editing `agent-stack.json` always triggers a rebuild**, regardless of commits, because it changes the config hash component.
- **Note:** If `git` fails (e.g., dubious ownership error when the repo is owned by a different user), the controller silently falls back to file-based hashing.

### File-Based Fallback

If `/srv/agent-stack/.git` is not available (e.g., the repo was deployed without git history), or if `git` commands fail (e.g., ownership mismatch), the controller falls back to a recursive `md5` hash of all files in the service directory (excluding `node_modules` and dotfiles). In this mode, any file edit on disk is detected immediately — no commit required.

## Auto-Injected Container Environment Variables

Every container service gets automatic env vars injected by the controller, providing service discovery for all services (both container and systemd-based) running on the same `stack-net` Podman network. This allows any service to discover and connect to any other service without hardcoded hostnames or ports.

### Variable Format

- `CONTAINERS_{NORMALIZED_NAME}_HOST` — the DNS-resolvable hostname
- `CONTAINERS_{NORMALIZED_NAME}_PRIMARY_PORT` — the service's primary port

`NORMALIZED_NAME` is the service name uppercased with non-alphanumeric characters replaced by underscores.

### Examples

Given these services:
- `opencode` (port 3000)
- `opencode-admin` (port 3002)
- `kilocode-web` (port 5003)

The container for `opencode` would receive:

```
CONTAINERS_OPENCODE_ADMIN_HOST=opencode-admin
CONTAINERS_OPENCODE_ADMIN_PRIMARY_PORT=3002
CONTAINERS_KILOCODE_WEB_HOST=kilocode-web
CONTAINERS_KILOCODE_WEB_PRIMARY_PORT=5003
```

The container for `opencode-admin` would receive:

```
CONTAINERS_OPENCODE_HOST=opencode
CONTAINERS_OPENCODE_PRIMARY_PORT=3000
CONTAINERS_KILOCODE_WEB_HOST=kilocode-web
CONTAINERS_KILOCODE_WEB_PRIMARY_PORT=5003
```

### Resolution Rules

- **Container-based services**: `_HOST` resolves to the container name, which is DNS-resolvable on the `stack-net` Podman network.
- **Systemd-based services**: `_HOST` resolves to `host.containers.internal` (the host running the systemd service, reachable from containers).

### `IS_CONTAINER`

Every container-managed service receives `IS_CONTAINER=true` injected automatically. Use this to resolve URLs correctly depending on whether the process is running inside a container or on the host.

#### API Base URL / Swagger

```bash
[ -n "$IS_CONTAINER" ] && BASE_URL="http://agent-stack" || BASE_URL="http://localhost"
SWAGGER_URL="${BASE_URL}/api/openapi.json"
```

When inside a container: `http://agent-stack/api/openapi.json`
When on the host: `http://localhost/api/openapi.json`

## Observability (OpenTelemetry)

An `observability` service provides distributed tracing via OpenTelemetry:

```
app → OTLP HTTP → otel-collector → OTLP gRPC → Tempo → Grafana UI
```

### Components

- **otel-collector** (sidecar) — Receives OTLP traces via HTTP at port 4318, batches them, and forwards to Tempo
- **Tempo** (sidecar) — Trace storage backend, receives OTLP gRPC from collector, retains traces for 48h
- **Grafana** (main container) — Web UI at `https://observability.ffilt.us`, pre-configured with Tempo datasource (Explore → Tempo → search)

All three run on the `stack-net` network. Services send traces to `http://observability--otel-collector:4318/v1/traces`.

### Env Vars Injected Into Every Service

Every container service automatically receives:

| Variable | Value |
|----------|-------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://observability--otel-collector:4318` |
| `OTEL_SERVICE_NAME` | `<service-name>` |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=production` |

These are standard OpenTelemetry env vars. Any service with an OTel SDK will auto-discover the collector.

### Adding Instrumentation to a Service

**Node.js services:** Install the OTel SDK packages and import a tracing initializer before all other imports:

```bash
npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/sdk-node @opentelemetry/semantic-conventions
```

```ts
// server/tracing.ts — imported first in your entry point
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { NodeSDK } from '@opentelemetry/sdk-node'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
if (endpoint) {
  const sdk = new NodeSDK({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  })
  sdk.start()
}
```

### Notes for opencode and opencode-admin

When configuring subagents, tools, or any service-to-service communication, prefer reading these env vars instead of hardcoding hostnames or ports. For example, an opencode subagent should use `process.env.CONTAINERS_OPENCODE_ADMIN_HOST` and `process.env.CONTAINERS_OPENCODE_ADMIN_PRIMARY_PORT` to reach the admin service, rather than assuming a fixed hostname or port.

## Agent-Stack Infrastructure Endpoints

For detailed information about the agent-stack infrastructure endpoints, including REST API endpoints, HTTP endpoints, and service proxying, see the [Agent-Stack Endpoints Documentation](../config/wiki/agent-stack-endpoints.md).

This documentation covers:
- REST API endpoints (/api/*)
- HTTP interfaces (/ping, /sudo, /status, /proxy/*)
- Unix socket interface
- Service management and logging capabilities
- Examples for interacting with the infrastructure programmatically