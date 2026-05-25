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
 │   ├── controller.js    # Main reconciliation loop + HTTP/API server
 │   ├── lib/             # Modular helper libraries
 │   │   ├── services.js
 │   │   ├── podman.js
 │   │   ├── cloudflared.js
 │   │   ├── runtime.js
 │   │   └── reconcile.js
 │   ├── package.json
 │   └── agent-stack.service
 ├── desired/             # Service definitions (JSON files) - ONLY for systemd-managed services
 │   └── cockpit.json
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
| `curl -s http://localhost/api/status` | Check controller health |
| `sudo systemctl restart cloudflared` | Restart tunnel after config change |

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

### `.wip` File

Create a file named `.wip` at the root of a service's repo directory to block rebuilds triggered by repo hash changes:

```bash
touch /srv/agent-stack/repos/<name>/.wip   # block rebuilds
# ... make edits, test, commit ...
rm /srv/agent-stack/repos/<name>/.wip        # re-enable — next reconcile picks up the new hash
```

When `.wip` is present, the repo hash component is skipped (`""`), so only `agent-stack.json` edits trigger a rebuild. This lets you batch multiple commits and test safely before deploying.

### File-Based Fallback

If `/srv/agent-stack/.git` is not available (e.g., the repo was deployed without git history), the controller falls back to a recursive `md5` hash of all files in the service directory (excluding `node_modules` and dotfiles). In this mode, any file edit on disk is detected immediately — no commit required.

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