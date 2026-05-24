# Agent Stack

A lightweight container orchestration system using Podman, Cloudflare Tunnel, and a Node.js controller that reconciles desired state.

## Architecture

```
desired/*.json → controller.js → podman containers + cloudflared tunnel
```

> **Note**: The `desired/` folder is **only for systemd-managed services** (like cockpit). For containerized services managed by the controller, configuration should be placed in each service's repository as `agent-stack.json`.

- **controller.js** - Runs every 5 seconds via systemd (`agent-stack.service`), compares desired/ state with running containers, builds images, starts/stops containers, and regenerates cloudflared config. **Do NOT run it manually** — the systemd service handles it automatically. Running a second instance directly will cause port conflicts and race conditions with the systemd-managed one. **Note: The AI assistant should not attempt to kill or restart the controller process directly.**
- **Podman** - Container runtime for running services
- **cloudflared** - Exposes services via Cloudflare Tunnel using ingress rules from service configs
- **systemd** - Runs controller as a service (`agent-stack.service`)

## Directory Structure

```
 /srv/agent-stack/
 ├── infra/               # Controller and dependencies
 │   ├── controller.js    # Main reconciliation loop + MCP HTTP/SSE server
 │   ├── lib/             # Modular helper libraries
 │   │   ├── services.js
 │   │   ├── podman.js
 │   │   ├── cloudflared.js
 │   │   ├── runtime.js
 │   │   └── reconcile.js
 │   ├── package.json
 │   └── agent-stack.service
 ├── desired/             # Service definitions (JSON files) - ONLY for systemd-managed services
 │   ├── cockpit.json
 │   └── opencode.json
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
| `node controller.js` | Run controller once (or as daemon with 5s interval) — **only for testing**; the systemd service handles production runs. Never leave a manual instance running — it will conflict. |
| `sudo systemctl status agent-stack` | Check if controller service is running |
| `sudo journalctl -u agent-stack -f` | Follow controller logs |
| `podman ps` | List running containers |
| `podman images` | List built images |
| `curl http://localhost:9000/mcp -X POST -d '{"method":"tools/list"}'` | Test MCP endpoint |
| `sudo systemctl restart cloudflared` | Restart tunnel after config change |

## Adding a Service

1. Create `/srv/agent-stack/repos/<name>/` with a `Dockerfile`
2. Add `/srv/agent-stack/repos/<name>/agent-stack.json`
3. Controller auto-detects and reconciles within 5 seconds

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
[ -n "$IS_CONTAINER" ] && BASE_URL="http://agent-stack" || BASE_URL="http://localhost:9000"
SWAGGER_URL="${BASE_URL}/api/openapi.json"
```

When inside a container: `http://agent-stack/api/openapi.json`
When on the host: `http://localhost:9000/api/openapi.json`

### Notes for opencode and opencode-admin

When configuring subagents, tools, or any service-to-service communication, prefer reading these env vars instead of hardcoding hostnames or ports. For example, an opencode subagent should use `process.env.CONTAINERS_OPENCODE_ADMIN_HOST` and `process.env.CONTAINERS_OPENCODE_ADMIN_PRIMARY_PORT` to reach the admin service, rather than assuming a fixed hostname or port.

## Agent-Stack Infrastructure Endpoints

For detailed information about the agent-stack infrastructure endpoints, including MCP tools, HTTP endpoints, and service proxying, see the [Agent-Stack Endpoints Documentation](../config/wiki/agent-stack-endpoints.md).

This documentation covers:
- All available MCP endpoints and tools
- HTTP interfaces (/mcp, /ping, /sudo, /status, /proxy/*)
- Unix socket interface
- Service management and logging capabilities
- Examples for interacting with the infrastructure programmatically