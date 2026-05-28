# Service Discovery

Every container service gets automatic env vars injected by the controller, providing service discovery for all services (both container and systemd-based) running on the same `stack-net` Podman network. This allows any service to discover and connect to any other service without hardcoded hostnames or ports.

## Variable Format

- `CONTAINERS_{NORMALIZED_NAME}_HOST` — the DNS-resolvable hostname
- `CONTAINERS_{NORMALIZED_NAME}_PRIMARY_PORT` — the service's primary port

`NORMALIZED_NAME` is the service name uppercased with non-alphanumeric characters replaced by underscores.

## Examples

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

## Resolution Rules

- **Container-based services**: `_HOST` resolves to the container name, which is DNS-resolvable on the `stack-net` Podman network.
- **Systemd-based services**: `_HOST` resolves to `host.containers.internal` (the host running the systemd service, reachable from containers).

## `IS_CONTAINER`

Every container-managed service receives `IS_CONTAINER=true` injected automatically. Use this to resolve URLs correctly depending on whether the process is running inside a container or on the host.

### API Base URL / Swagger

```bash
[ -n "$IS_CONTAINER" ] && BASE_URL="http://agent-stack" || BASE_URL="http://localhost"
SWAGGER_URL="${BASE_URL}/api/openapi.json"
```

When inside a container: `http://agent-stack/api/openapi.json`
When on the host: `http://localhost/api/openapi.json`

## Notes for opencode and opencode-admin

When configuring subagents, tools, or any service-to-service communication, prefer reading these env vars instead of hardcoding hostnames or ports. For example, an opencode subagent should use `process.env.CONTAINERS_OPENCODE_ADMIN_HOST` and `process.env.CONTAINERS_OPENCODE_ADMIN_PRIMARY_PORT` to reach the admin service, rather than assuming a fixed hostname or port.
