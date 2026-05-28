# Architecture & Operations

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
