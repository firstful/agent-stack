# Agent-Stack Infrastructure Endpoints

This document describes all exposed endpoints provided by the agent-stack infrastructure controller.

> **Note**: The `desired/` folder is **only for systemd-managed services** (like cockpit). For containerized services managed by the controller, configuration should be placed in each service's repository as `agent-stack.json`.

> **Note**: The `desired/` folder is **only for systemd-managed services** (like cockpit). For containerized services managed by the controller, configuration should be placed in each service's repository as `agent-stack.json`.

## HTTP/MCP Endpoints (Controller.js)

The controller exposes an HTTP server on port **80** (internally mapped to host port 4007) with the following endpoints:

### 1. **GET /mcp**
- **Description**: MCP (Model Context Protocol) endpoint for Server-Sent Events (SSE)
- **Response**: 
  - Sets up SSE connection with heartbeat every 30 seconds
  - Initial message: `event: endpoint\ndata: /mcp\n\n`
  - Heartbeat: `event: heartbeat\ndata: \n\n`
- **Headers**: 
  - Content-Type: text/event-stream
  - Cache-Control: no-cache
  - Connection: keep-alive

### 2. **POST /mcp**
- **Description**: MCP endpoint for receiving JSON-RPC style requests
- **Expected Body**: JSON object with `method` and optional `params`
- **Supported Methods**:
  - `tools/list` - Returns list of available tools
  - `tools/call` - Executes a specific tool with provided arguments

### 3. **POST /mcp/<tool_name>**
- **Description**: Direct tool execution endpoint (alternative to POST /mcp with tools/call)
- **Examples**: 
  - POST /mcp/list_services
  - POST /mcp/get_service_status
  - POST /mcp/get_log_analytics
- **Expected Body**: JSON object with tool-specific arguments

### 4. **GET /ping**
- **Description**: Simple health check endpoint
- **Response**: `{"status": "ok"}`
- **Headers**: Content-Type: application/json

### 5. **POST /sudo**
- **Description**: Execute privileged commands with sudo (requires authentication)
- **Expected Body**: 
  ```json
  {
    "password": "<admin_password>",
    "command": "<shell_command_to_execute>"
  }
  ```
- **Authentication**: Password must match stored admin password (`.password.txt`)
- **Response**: 
  ```json
  {
    "output": "<command_output>"
  }
  ```

### 6. **GET /status**
- **Description**: Get comprehensive controller and system status
- **Response**: JSON object containing:
  - `healthy`: Boolean indicating system health
  - `uptime`: Seconds since controller started
  - `startTime`: ISO timestamp of controller start
  - `lastReconcile`: Timestamp of last reconciliation
  - `reconcileCount`: Number of reconciliation runs
  - `reconcileErrors`: Last 50 reconciliation errors
  - `buildErrors`: Build errors
  - `toolErrors`: Last 50 tool execution errors
  - `cloudflaredError`: Last cloudflared error
  - `services`: Current state of all managed services

### 7. **GET /proxy/<service_name>[/<path>]**
- **Description**: Proxy requests to individual managed services
- **Path Parameters**: 
  - `service_name`: Name of service to proxy to (must exist in services.json and be running)
  - `path`: Optional path to forward to the service (defaults to "/")
- **Behavior**:
  - Looks up service in runtime state
  - Forwards request to `localhost:<service_port><path>`
  - Preserves original method, headers (except Host)
  - Returns service response or 502 error if service not found/not running

## MCP Tools (Available via /mcp endpoint)

The following tools are available through the MCP interface:

### Service Management Tools
1. **list_services**
   - Description: List all services
   - Parameters: None
   
2. **get_service_status**
   - Description: Get status of a specific service
   - Parameters: `{ name: string }` (required)

3. **create_service**
   - Description: Create a new service
   - Parameters: 
     ```json
     {
       "name": string (required),
       "repo": string (required),
       "port": number,
       "host_port": number,
       "auto_port": boolean,
       "env": object,
       "volumes": string[],
       "expose_enabled": boolean,
       "hostname": string,
       "tunnel": string
     }
     ```

4. **update_service**
   - Description: Update an existing service
   - Parameters: 
     ```json
     {
       "name": string (required),
       "port": number,
       "host_port": number,
       "auto_port": boolean,
       "env": object,
       "volumes": string[],
       "expose_enabled": boolean,
       "hostname": string,
       "tunnel": string
     }
     ```

5. **delete_service**
   - Description: Delete a service
   - Parameters: `{ name: string }` (required)

6. **start_service**
   - Description: Start a service
   - Parameters: `{ name: string }` (required)

7. **stop_service**
   - Description: Stop a service
   - Parameters: `{ name: string }` (required)

8. **restart_service**
   - Description: Restart a service
   - Parameters: `{ name: string }` (required)

9. **rebuild_service**
   - Description: Rebuild a service container from latest source
   - Parameters: `{ name: string }` (required)

10. **reconcile**
    - Description: Trigger reconciliation process
    - Parameters: None

### Logging Tools
11. **get_service_logs**
    - Description: Get logs for a specific service
    - Parameters: 
      ```json
      {
        "name": string (required),
        "lines": number (default: 100)
      }
      ```

12. **get_log_analytics**
    - Description: Get aggregated logs from multiple sources
    - Parameters:
      ```json
      {
        "sources": string[] (optional, defaults to ["controller", "cloudflared", "podman"]),
        "lines": number (default: 100),
        "containerName": string (required when sources includes "container")
      }
      ```
    - **Available Sources**: "controller", "cloudflared", "podman", "agent-stack", "container"
    - **Response**: Object with keys matching requested sources and log content as values

## REST API Endpoints (`/api/*`)

The same functionality is also exposed as RESTful HTTP endpoints. These map 1:1 to MCP tools but follow standard resource-oriented conventions.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Controller and system health status |
| GET | `/api/services` | List all services |
| GET | `/api/services/{name}` | Get a single service's status |
| POST | `/api/services` | Create a new service |
| PUT | `/api/services/{name}` | Update an existing service |
| DELETE | `/api/services/{name}` | Delete a service |
| POST | `/api/services/{name}/start` | Start a service |
| POST | `/api/services/{name}/stop` | Stop a service |
| POST | `/api/services/{name}/restart` | Restart a service |
| POST | `/api/services/{name}/rebuild` | Rebuild service container |
| POST | `/api/reconcile` | Trigger reconciliation cycle |
| GET | `/api/logs/{name}` | Get container logs (`?lines=N`) |
| POST | `/api/logs/analytics` | Aggregated logs from multiple sources |
| GET | `/api/openapi.json` | This API's OpenAPI 3.0 specification |

Examples:

```bash
# Status
curl http://localhost/api/status

# List services
curl http://localhost/api/services

# Get a specific service
curl http://localhost/api/services/opencode

# Start/stop/restart/rebuild
curl -X POST http://localhost/api/services/opencode/restart

# Get logs
curl http://localhost/api/logs/opencode?lines=50

# Log analytics
curl -X POST http://localhost/api/logs/analytics \
  -H "Content-Type: application/json" \
  -d '{"sources":["controller","container"],"lines":20,"containerName":"opencode"}'
```

### OpenAPI Specification

A live [OpenAPI 3.0](https://swagger.io/specification/) specification is served by the running controller at:

- **`/api/openapi.json`** — generated on-the-fly from the declarative TypeScript route registry at `infra/lib/routes.ts`

Each route definition carries its own OpenAPI metadata; `buildOpenApiSpec()` derives the full spec from that table. No static file — it always matches the running code.

To regenerate a static copy for offline use:

```bash
npm run generate-openapi
```

## Unix Socket Interface

In addition to HTTP, the controller also listens on a Unix socket:
- **Path**: `/tmp/agent-stack.sock`
- **Functionality**: Identical to HTTP endpoints (same handler function)
- **Purpose**: Local inter-process communication without network exposure

## Service-Specific Endpoints (via Proxy)

When services are running and healthy, the `/proxy/<service_name>` endpoint allows access to:
- Each service's native API/web interface
- Service-specific endpoints (varies by service)
- Examples:
  - `/proxy/opencode` → OpenCode API/UI
  - `/proxy/kilocode-web` → Kilocode web interface
  - `/proxy/dash` → Dashboard interface
  - `/proxy/techdeck` → Techdeck application
  - And others as defined in their respective configurations

## Implementation Notes

1. **Port Configuration**: Controller listens on port 80 internally, but gets mapped to host port 4007 via container configuration
2. **Authentication**: The `/sudo` endpoint requires authentication using credentials stored in `.password.txt` and `.sudo-password.txt`
3. **Logging**: All controller activity is logged to `__dirname/controller.log`
4. **Watchdog**: Controller automatically restarts when infrastructure files change (via fs.watch)
5. **Worker Thread**: Reconciliation logic runs in a separate worker thread for stability

## Related Documents

- [Slot-Based Container Restart Plan](slot-swap-plan.md) — zero-downtime blue-green deployment design