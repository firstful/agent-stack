// Declarative route registry — single source of truth for REST API routes.
// Both the HTTP dispatcher (controller.ts) and the OpenAPI generator
// consume this table.  Run directly via tsx — no compile step needed.

export interface OpenApiParam {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema: Record<string, unknown> }>;
}

export interface OpenApiRequest {
  required?: boolean;
  content?: Record<string, { schema: Record<string, unknown> }>;
}

export interface OpenApiMeta {
  summary: string;
  tags: string[];
  parameters?: OpenApiParam[];
  requestBody?: OpenApiRequest;
  responses: Record<string, OpenApiResponse>;
}

export interface RouteDef {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: string;
  params: string[];
  handlerName: string;
  openapi: OpenApiMeta;
}

export interface CompiledRoute extends RouteDef {
  regex: RegExp;
  paramNames: string[];
}

export interface RouteMatch {
  handlerName: string;
  params: Record<string, string>;
  openapi: OpenApiMeta;
}

const routes: RouteDef[] = [
  // ── Status ──────────────────────────────────────────────
  {
    method: "GET",
    pattern: "/api/status",
    params: [],
    handlerName: "handleApiStatus",
    openapi: {
      summary: "Controller and system health status",
      tags: ["Status"],
      responses: {
        "200": {
          description: "Health status with error lists",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  healthy: { type: "boolean" },
                  uptime: { type: "integer", description: "Seconds since start" },
                  startTime: { type: "string", format: "date-time" },
                  lastReconcile: { type: "string", format: "date-time", nullable: true },
                  reconcileCount: { type: "integer" },
                  reconcileErrors: { type: "array", items: { type: "string" } },
                  buildErrors: { type: "array", items: { type: "string" } },
                  toolErrors: { type: "array", items: { type: "object" } },
                  cloudflaredError: { type: "string", nullable: true },
                  services: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
  },

  // ── Services ────────────────────────────────────────────
  {
    method: "GET",
    pattern: "/api/services",
    params: [],
    handlerName: "handleApiServicesList",
    openapi: {
      summary: "List all services",
      tags: ["Services"],
      responses: {
        "200": {
          description: "Array of service summaries",
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    file: { type: "string" },
                    port: { type: "integer" },
                    running: { type: "boolean" },
                    exposed: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/services",
    params: [],
    handlerName: "handleApiServicesCreate",
    openapi: {
      summary: "Create a new service",
      tags: ["Services"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "repo"],
              properties: {
                name: { type: "string" },
                repo: { type: "string" },
                port: { type: "integer" },
                host_port: { type: "integer" },
                auto_port: { type: "boolean" },
                env: { type: "object", additionalProperties: { type: "string" } },
                volumes: { type: "array", items: { type: "string" } },
                expose_enabled: { type: "boolean" },
                hostname: { type: "string" },
                tunnel: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Service created" },
        "400": { description: "Validation error" },
      },
    },
  },
  {
    method: "GET",
    pattern: "/api/services/:name",
    params: ["name"],
    handlerName: "handleApiServiceGet",
    openapi: {
      summary: "Get service status",
      tags: ["Services"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service runtime state" },
        "404": { description: "Service not found" },
      },
    },
  },
  {
    method: "PUT",
    pattern: "/api/services/:name",
    params: ["name"],
    handlerName: "handleApiServiceUpdate",
    openapi: {
      summary: "Update a service",
      tags: ["Services"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                port: { type: "integer" },
                host_port: { type: "integer" },
                auto_port: { type: "boolean" },
                env: { type: "object" },
                volumes: { type: "array", items: { type: "string" } },
                expose_enabled: { type: "boolean" },
                hostname: { type: "string" },
                tunnel: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Service updated" },
        "400": { description: "Validation error" },
      },
    },
  },
  {
    method: "DELETE",
    pattern: "/api/services/:name",
    params: ["name"],
    handlerName: "handleApiServiceDelete",
    openapi: {
      summary: "Delete a service",
      tags: ["Services"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service deleted" },
        "404": { description: "Service not found" },
      },
    },
  },

  // ── Service actions ─────────────────────────────────────
  {
    method: "POST",
    pattern: "/api/services/:name/start",
    params: ["name"],
    handlerName: "handleApiServiceStart",
    openapi: {
      summary: "Start a service",
      tags: ["Service Actions"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service started" },
        "500": { description: "Failed to start" },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/services/:name/stop",
    params: ["name"],
    handlerName: "handleApiServiceStop",
    openapi: {
      summary: "Stop a service",
      tags: ["Service Actions"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service stopped" },
        "500": { description: "Failed to stop" },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/services/:name/restart",
    params: ["name"],
    handlerName: "handleApiServiceRestart",
    openapi: {
      summary: "Restart a service",
      tags: ["Service Actions"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service restarted" },
        "500": { description: "Failed to restart" },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/services/:name/rebuild",
    params: ["name"],
    handlerName: "handleApiServiceRebuild",
    openapi: {
      summary: "Rebuild a service container from latest source",
      tags: ["Service Actions"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Service rebuilt" },
        "500": { description: "Failed to rebuild" },
      },
    },
  },

  // ── Reconcile ───────────────────────────────────────────
  {
    method: "POST",
    pattern: "/api/reconcile",
    params: [],
    handlerName: "handleApiReconcile",
    openapi: {
      summary: "Trigger an immediate reconciliation cycle",
      tags: ["Control"],
      responses: {
        "200": { description: "Reconciliation triggered" },
      },
    },
  },

  // ── Logs ────────────────────────────────────────────────
  {
    method: "GET",
    pattern: "/api/logs/:name",
    params: ["name"],
    handlerName: "handleApiLogsGet",
    openapi: {
      summary: "Get container logs for a specific service",
      tags: ["Logs"],
      parameters: [
        { name: "name", in: "path", required: true, schema: { type: "string" } },
        { name: "lines", in: "query", schema: { type: "integer", default: 100 }, description: "Number of tail lines" },
      ],
      responses: {
        "200": { description: "Log output", content: { "text/plain": { schema: { type: "string" } } } },
        "500": { description: "Failed to retrieve logs" },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/logs/analytics",
    params: [],
    handlerName: "handleApiLogsAnalytics",
    openapi: {
      summary: "Get aggregated logs from multiple sources",
      tags: ["Logs"],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                sources: {
                  type: "array",
                  items: { type: "string", enum: ["controller", "cloudflared", "podman", "agent-stack", "container"] },
                },
                lines: { type: "integer", default: 100 },
                containerName: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Per-source log output",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
        },
      },
    },
  },

  // ── Performance ───────────────────────────────────────
  {
    method: "GET",
    pattern: "/api/perf",
    params: [],
    handlerName: "handleApiPerf",
    openapi: {
      summary: "Get historical performance snapshots",
      tags: ["Performance"],
      responses: {
        "200": {
          description: "Historical performance data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  snapshots: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        system: { type: "object" },
                        containers: { type: "array", items: { type: "object" } },
                        topCpuProcesses: { type: "array", items: { type: "object" } },
                        topMemProcesses: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    method: "POST",
    pattern: "/api/perf/collect",
    params: [],
    handlerName: "handleApiPerfCollect",
    openapi: {
      summary: "Trigger an immediate performance snapshot collection",
      tags: ["Performance"],
      responses: {
        "200": {
          description: "Snapshot collected",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  snapshot: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
  },

  // ── OpenAPI spec ────────────────────────────────────────
  {
    method: "GET",
    pattern: "/api/openapi.json",
    params: [],
    handlerName: "handleApiOpenApi",
    openapi: {
      summary: "Get the OpenAPI specification for this API",
      tags: ["Meta"],
      responses: {
        "200": { description: "OpenAPI 3.0 JSON spec" },
        "404": { description: "Spec file not found" },
      },
    },
  },
];

// ── Route Compilation ──

// Converts a pattern like "/api/services/:name" to a RegExp
function patternToRegex(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([a-zA-Z_]+)/g, (_: string, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

// Pre-compile routes for fast dispatch
const compiled: CompiledRoute[] = routes.map((r) => {
  const { regex, paramNames } = patternToRegex(r.pattern);
  return { ...r, regex, paramNames };
});

// ── Dispatch ──

// Match a (method, pathname) pair against the route table
function matchRoute(method: string, pathname: string): RouteMatch | null {
  for (const route of compiled) {
    if (route.method !== method) continue;
    const m = pathname.match(route.regex);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = m[i + 1];
    });
    return { handlerName: route.handlerName, params, openapi: route.openapi };
  }
  return null;
}

// ── OpenAPI Specification ──

// Build full OpenAPI 3.0 spec from route metadata
export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  paths: Record<string, Record<string, OpenApiMeta>>;
}

function buildOpenApiSpec(): OpenApiSpec {
  const paths: Record<string, Record<string, OpenApiMeta>> = {};
  for (const route of routes) {
    if (!paths[route.pattern]) paths[route.pattern] = {};
    const method = route.method.toLowerCase();
    paths[route.pattern][method] = route.openapi;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Agent-Stack Infrastructure API",
      version: "1.0.0",
      description:
        "REST API for the agent-stack container orchestration system. All endpoints return JSON unless noted otherwise.",
    },
    servers: [
      { url: "http://localhost:80", description: "Internal (container network)" },
      { url: "http://agent-stack:80", description: "DNS-resolvable on stack-net" },
    ],
    paths,
  };
}

export { routes, compiled, matchRoute, buildOpenApiSpec };
