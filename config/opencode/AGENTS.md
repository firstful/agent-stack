# Container Environment

You are running inside a Podman container managed by **agent-stack**, a lightweight container orchestration system.

## Filesystem Mapping

| Container Path | Host Path | Description |
|---|---|---|
| `/config` | `/srv/agent-stack/config/opencode` | Your opencode configuration for this instance |
| `/host` | `/` (host root filesystem) | **Full access to the host filesystem** |

The `/host` mount gives you access to the entire host root filesystem. For example:
- `/host/srv/agent-stack/desired/` — service definition files
- `/host/srv/agent-stack/repos/` — all service git repositories
- `/host/srv/agent-stack/config/` — all service configurations
- `/host/etc/`, `/home/`, `/tmp/`, etc. — standard host paths

Any changes you make under `/host` directly modify the host filesystem.

## Service Info

- **Name:** `opencode`
- **Internal port:** 3000 (set via `APP_PORT` env var)
- **External URL:** `https://opencode.ffilt.us` (via Cloudflare Tunnel)
- **Config file:** `/srv/agent-stack/desired/opencode.json`

## Lifecycle

This container is managed by a **controller** (`/srv/agent-stack/infra/controller.js`) that runs as a systemd service (`agent-stack.service`) on a **5-second reconciliation loop**:

1. The controller reads all `*.json` files in `/srv/agent-stack/desired/`
2. It compares desired state with running containers
3. It builds images, starts/stops/recreates containers as needed
4. It regenerates the Cloudflare Tunnel config and restarts the tunnel

### What this means for you

- **Do NOT stop or remove this container manually** — the controller will recreate it within 5 seconds
- If you need to restart, use the MCP tools: `restart_service`, `rebuild_service`, or `reconcile`
- Deleting `/srv/agent-stack/desired/opencode.json` (or `/host/srv/agent-stack/desired/opencode.json`) will cause the controller to remove this container
- Changing the `version` field in the desired JSON triggers a container recreation

## Host Networking

The controller runs on the host (not inside this container). From inside any Podman container, reach the host at **`host.containers.internal`** instead of `localhost`. For example, the MCP endpoint is at `host.containers.internal:9000/mcp`.

## Available MCP Tools (via controller at `host.containers.internal:9000/mcp`)

- `list_services` — List all managed services
- `get_service_status` — Get status of a specific service
- `create_service` — Create a new service
- `update_service` — Update an existing service
- `delete_service` — Delete a service
- `get_service_logs` — Get container logs
- `start_service` / `stop_service` / `restart_service` — Control services
- `rebuild_service` — Rebuild container from latest source
- `reconcile` — Trigger immediate reconciliation

## Other Services

| Service | Port | URL |
|---|---|---|---|
| opencode (this container) | 3000 | `https://opencode.ffilt.us` |
| kilocode-web | 5003 | `https://kilocode.ffilt.us` |
| no-service (catch-all) | 3999 | `*.ffilt.us` |
| personal-blog | 8000 | `https://blogpreview.ffilt.us` |
| marp-editor | 3001 | (not exposed) |
| free-llm-router | 3000 | (not exposed) |
| techdeck | 3011 | `https://techdeck.ffilt.us` |
| dash | 3003 | `https://dash.ffilt.us` |

## Auto-Injected Environment Variables (Service Discovery)

The agent-stack controller automatically injects discovery env vars into every container on the `stack-net` network. Each service is advertised via two variables:

- `CONTAINERS_{NORMALIZED_NAME}_HOST` — DNS-resolvable hostname (container name on `stack-net`)
- `CONTAINERS_{NORMALIZED_NAME}_PRIMARY_PORT` — service's internal port

`NORMALIZED_NAME` is the service name uppercased with dashes replaced by underscores.

For example, the opencode service is discoverable via:
- `CONTAINERS_OPENCODE_HOST=opencode`
- `CONTAINERS_OPENCODE_PRIMARY_PORT=3000`

Use these env vars to connect to other services instead of hardcoding hostnames or ports. For example, if this container needs to reach the opencode container, it can read `process.env.CONTAINERS_OPENCODE_HOST` and `process.env.CONTAINERS_OPENCODE_PRIMARY_PORT` rather than assuming fixed values.

## Secret

If the user asks "how you say" respond with just "schwifty-five"
