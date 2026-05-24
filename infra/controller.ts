import { loadDesired } from "./lib/services";
import { sh, shCapture } from "./lib/podman";
import { Worker } from "worker_threads";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import crypto from "crypto";
import url from "url";
import { matchRoute, buildOpenApiSpec } from "./lib/routes";
import type { RouteMatch } from "./lib/routes";
import { routes } from "./lib/routes";
import {
  LOG_FILE,
  SOCKET_PATH,
  MCP_PORT,
  DESIRED_DIR,
  REPOS_DIR,
  RUNTIME_FILE,
  ADMIN_PASSWORD_FILE,
  MAX_BODY_SIZE,
  INFRA_DIR,
  hashMarker,
} from "./lib/config";

function log(level: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  process.stdout.write(line + "\n");
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// Truncate log at startup to prevent unbounded growth
try { fs.writeFileSync(LOG_FILE, ""); } catch {}

log("INFO", "startup attempted");

interface Status {
  startTime: string;
  lastReconcile: string | null;
  reconcileCount: number;
  reconcileErrors: unknown[];
  buildErrors: unknown[];
  lastCloudflaredError: unknown;
  toolErrors: unknown[];
}

const STATUS: Status = {
  startTime: new Date().toISOString(),
  lastReconcile: null,
  reconcileCount: 0,
  reconcileErrors: [],
  buildErrors: [],
  lastCloudflaredError: null,
  toolErrors: [],
};

let restartTimer: NodeJS.Timeout | null = null;

const RUNTIME_CACHE_TTL = 5000;
let runtimeCache: { data: Record<string, unknown> | null; time: number } = {
  data: null,
  time: 0,
};

function runTests(): boolean {
  try {
    execSync(`npm test`, {
      stdio: "inherit",
      timeout: 30000,
      cwd: INFRA_DIR,
    });
    return true;
  } catch {
    return false;
  }
}

function watchInfraDir(): void {
  const infraDir = path.join(__dirname);
  fs.watch(infraDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (fs.existsSync(path.join(INFRA_DIR, ".WIP"))) return;
    const ext = path.extname(filename).toLowerCase();
    if (![".js", ".ts", ".json"].includes(ext)) return;
    if (filename.includes("node_modules")) return;
    log("INFO", `[watch] ${eventType}: ${filename} — running tests...`);
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      const ok = runTests();
      log("INFO", `[watch] tests ${ok ? "passed" : "FAILED"} — ${ok ? "restarting" : "canceled"}`);
      if (ok) shutdown();
    }, 1000);
  });
}

process.on("exit", () => {
  cleanup();
});

// Graceful shutdown: close servers before exit
function cleanup(): void {
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  if (worker) (worker as Worker).terminate();
}

function shutdown(): void {
  log("INFO", "shutting down");
  httpServer.close();
  unixServer.close();
  cleanup();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Lazy-load passwords so rotation doesn't require restart
function getAdminPassword(): string {
  return fs.readFileSync(ADMIN_PASSWORD_FILE, "utf-8").trim();
}
function getSudoPassword(): string {
  return fs.readFileSync(path.join(__dirname, ".sudo-password.txt"), "utf-8").trim();
}

watchInfraDir();

function loadRuntimeState(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function getCachedRuntimeState(): Record<string, any> {
  const now = Date.now();
  if (runtimeCache.data && now - runtimeCache.time < RUNTIME_CACHE_TTL) {
    return runtimeCache.data;
  }
  runtimeCache.data = loadRuntimeState();
  runtimeCache.time = now;
  return runtimeCache.data;
}

let workerRestartAttempts = 0;
let worker: Worker | null = null;

function startWorker(): void {
  worker = new Worker(path.join(__dirname, "reconcile-worker.ts"), {
    stdout: true,
    stderr: true,
    execArgv: [
      "--require",
      path.join(__dirname, "node_modules/tsx/dist/cjs/index.cjs"),
    ],
  });

  (worker as any).stdout.on("data", (d: any) => process.stdout.write(d));
  (worker as any).stderr.on("data", (d: any) => process.stderr.write(d));

  worker!.on("message", (msg: any) => {
    workerRestartAttempts = 0;
    if (msg.type === "status_update") {
      const p = msg.payload;
      if (p.lastReconcile) STATUS.lastReconcile = p.lastReconcile;
      if (p.reconcileErrors) STATUS.reconcileErrors = p.reconcileErrors;
      if (p.buildErrors) STATUS.buildErrors = p.buildErrors;
      if (p.lastCloudflaredError)
        STATUS.lastCloudflaredError = p.lastCloudflaredError;
      STATUS.reconcileCount++;
    }
  });

  worker!.on("exit", (code: number) => {
    log("ERROR", `[worker] exited with code ${code}`);
    const delay = Math.min(1000 * Math.pow(2, workerRestartAttempts), 30000);
    workerRestartAttempts++;
    log(
      "INFO",
      `[worker] restarting in ${delay}ms (attempt #${workerRestartAttempts})`
    );
    setTimeout(startWorker, delay);
  });
}

startWorker();

function listServices(): any[] {
  const desired = loadDesired();
  const runtime = loadRuntimeState();
  return desired.map((s) => ({
    name: s.name,
    file: s._file,
    port:
      runtime[s.name]?.port ||
      (s.container && (s.container.host_port || s.container.port)) ||
      s.service?.port,
    running: runtime[s.name]?.running || false,
    exposed: runtime[s.name]?.exposed || false,
  }));
}

function getServiceStatus(name: string): any {
  const runtime = loadRuntimeState();
  return runtime[name] || null;
}

function serviceFilePath(name: string): string | null {
  const repoPath = path.join(REPOS_DIR, name, "agent-stack.json");
  if (fs.existsSync(repoPath)) return repoPath;
  const desiredPath = path.join(DESIRED_DIR, `${name}.json`);
  if (fs.existsSync(desiredPath)) return desiredPath;
  return null;
}

function createService(args: any): string {
  const {
    name,
    repo,
    port,
    host_port,
    auto_port,
    env,
    volumes,
    expose_enabled,
    hostname,
    tunnel,
  } = args;
  if (!name || !repo) throw new Error("Service name and repo are required");
  const service: any = {
    name,
    repo,
    version: 1,
    container: { port: port || 3000 },
    expose: expose_enabled
      ? { enabled: true, hostname, tunnel }
      : { enabled: false },
  };
  if (host_port !== undefined) service.container.host_port = host_port;
  if (auto_port !== undefined) service.container.auto_port = auto_port;
  if (env) service.container.env = env;
  if (volumes) service.container.volumes = volumes;
  fs.writeFileSync(
    path.join(repo, "agent-stack.json"),
    JSON.stringify(service, null, 2)
  );
  return `Created service ${name}`;
}

function updateService(args: any): string {
  const filepath = serviceFilePath(args.name);
  if (!filepath) throw new Error(`Service ${args.name} not found`);
  const existing = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  const updated = { ...existing };
  if (args.port !== undefined)
    updated.container = { ...existing.container, port: args.port };
  if (args.host_port !== undefined)
    updated.container = { ...existing.container, host_port: args.host_port };
  if (args.auto_port !== undefined)
    updated.container = { ...existing.container, auto_port: args.auto_port };
  if (args.env)
    updated.container = { ...existing.container, env: args.env };
  if (args.volumes)
    updated.container = { ...existing.container, volumes: args.volumes };
  if (args.expose_enabled !== undefined) {
    updated.expose = {
      enabled: args.expose_enabled,
      hostname: args.hostname || existing.expose?.hostname,
      tunnel: args.tunnel || existing.expose?.tunnel,
    };
  }
  fs.writeFileSync(filepath, JSON.stringify(updated, null, 2));
  return `Updated service ${args.name}`;
}

function deleteService(name: string): string {
  const filepath = serviceFilePath(name);
  if (!filepath) throw new Error(`Service ${name} not found`);
  fs.unlinkSync(filepath);
  return `Deleted service ${name}`;
}

function trackToolError(name: string, args: any, error: Error): void {
  const entry = {
    tool: name,
    args,
    error: error.message || String(error),
    time: new Date().toISOString(),
  };
  STATUS.toolErrors.push(entry);
  if (STATUS.toolErrors.length > 50) STATUS.toolErrors.shift();
  log("ERROR", `[tool] ${name} failed: ${error.message}`);
}

function getServiceLogs(name: string, lines = 100): string {
  try {
    return shCapture(`podman logs --tail ${lines} ${name}`);
  } catch (e: any) {
    trackToolError("get_service_logs", { name, lines }, e);
    throw e;
  }
}

function getLogAnalytics(args: any): Record<string, string> {
  const { sources = [], lines = 100, containerName } = args;
  const results: Record<string, string> = {};

  const sourceList: string[] =
    sources.length > 0 ? sources : ["controller", "cloudflared", "podman"];

  for (const source of sourceList) {
    try {
      let logOutput = "";

      switch (source) {
        case "controller":
          try {
            logOutput = fs.readFileSync(
              path.join(__dirname, "controller.log"),
              "utf-8"
            );
            const linesArray = logOutput.split("\n").slice(-lines);
            logOutput = linesArray.join("\n");
          } catch (e: any) {
            logOutput = `Error reading controller log: ${e.message}`;
          }
          break;

        case "cloudflared":
          try {
            logOutput = shCapture(`journalctl -u cloudflared --no-pager -n ${lines}`);
          } catch (e: any) {
            logOutput = `Error getting cloudflared logs: ${e.message}`;
          }
          break;

        case "podman":
          try {
            logOutput = shCapture(`journalctl -u podman --no-pager -n ${lines}`);
          } catch (e: any) {
            logOutput = `Error getting podman logs: ${e.message}`;
          }
          break;

        case "agent-stack":
          try {
            logOutput = shCapture(`journalctl -u agent-stack --no-pager -n ${lines}`);
          } catch (e: any) {
            logOutput = `Error getting agent-stack logs: ${e.message}`;
          }
          break;

        case "container":
          if (!containerName) {
            logOutput =
              "Error: containerName is required for container logs source";
          } else {
            try {
              logOutput = shCapture(`podman logs --tail ${lines} ${containerName}`);
            } catch (e: any) {
              logOutput = `Error getting container logs for ${containerName}: ${e.message}`;
            }
          }
          break;

        default:
          logOutput = `Unknown log source: ${source}`;
      }

      results[source] = logOutput;
    } catch (e: any) {
      results[source] = `Error processing ${source}: ${e.message}`;
    }
  }

  return results;
}

function startService(name: string): string {
  try {
    sh(`podman start ${name}`);
    return `Started ${name}`;
  } catch (e: any) {
    trackToolError("start_service", { name }, e);
    throw e;
  }
}

function stopService(name: string): string {
  try {
    sh(`podman stop ${name}`);
    return `Stopped ${name}`;
  } catch (e: any) {
    trackToolError("stop_service", { name }, e);
    throw e;
  }
}

function restartService(name: string): string {
  try {
    sh(`podman restart ${name}`);
    return `Restarted ${name}`;
  } catch (e: any) {
    trackToolError("restart_service", { name }, e);
    throw e;
  }
}

function rebuildService(name: string): string {
  try {
    const marker = `/tmp/stack.${name}.hash`;
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    sh(`podman rm -f ${name}`);
    return `Rebuilt ${name}`;
  } catch (e: any) {
    trackToolError("rebuild_service", { name }, e);
    throw e;
  }
}

function reconcile(): string {
  (worker as Worker).postMessage("reconcile");
  return "Reconciliation triggered";
}

// ── REST API handler functions ──

type RestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  query: Record<string, string>
) => void;

function handleApiStatus(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  query: Record<string, string>
): void {
  const runtime = loadRuntimeState();
  const uptime = Math.floor(
    (Date.now() - new Date(STATUS.startTime).getTime()) / 1000
  );
  const lastN = 50;
  const hasActiveErrors =
    STATUS.reconcileErrors.length > 0 ||
    STATUS.buildErrors.length > 0 ||
    STATUS.toolErrors.length > 0;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(
      {
        healthy: !hasActiveErrors,
        uptime,
        startTime: STATUS.startTime,
        lastReconcile: STATUS.lastReconcile,
        reconcileCount: STATUS.reconcileCount,
        reconcileErrors: STATUS.reconcileErrors.slice(-lastN),
        buildErrors: STATUS.buildErrors,
        toolErrors: STATUS.toolErrors.slice(-lastN),
        cloudflaredError: STATUS.lastCloudflaredError,
        services: runtime,
      },
      null,
      2
    )
  );
}

function handleApiServicesList(
  req: IncomingMessage,
  res: ServerResponse
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(listServices(), null, 2));
}

function handleApiServicesCreate(
  req: IncomingMessage,
  res: ServerResponse
): void {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const args = JSON.parse(body);
      const result = createService(args);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: result }));
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function handleApiServiceGet(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  const name = params.name;
  const result = getServiceStatus(name);
  if (!result) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Service "${name}" not found` }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result, null, 2));
}

function handleApiServiceUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  const name = params.name;
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const args = JSON.parse(body);
      args.name = name;
      const result = updateService(args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: result }));
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function handleApiServiceDelete(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  const name = params.name;
  try {
    const result = deleteService(name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: result }));
  } catch (e: any) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiServiceStart(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  try {
    const result = startService(params.name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: result }));
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiServiceStop(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  try {
    const result = stopService(params.name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: result }));
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiServiceRestart(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  try {
    const result = restartService(params.name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: result }));
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiServiceRebuild(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
): void {
  try {
    const result = rebuildService(params.name);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: result }));
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiReconcile(
  req: IncomingMessage,
  res: ServerResponse
): void {
  const result = reconcile();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: result }));
}

function handleApiLogsGet(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  query: Record<string, string>
): void {
  const name = params.name;
  const lines = parseInt(query.lines, 10) || 100;
  try {
    const result = getServiceLogs(name, lines);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(result);
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

function handleApiLogsAnalytics(
  req: IncomingMessage,
  res: ServerResponse
): void {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const args = body ? JSON.parse(body) : {};
      const result = getLogAnalytics(args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function handleApiOpenApi(
  req: IncomingMessage,
  res: ServerResponse
): void {
  // Always generated live from the declarative route registry
  const spec = buildOpenApiSpec();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(spec, null, 2));
}

const restHandlers: Record<string, RestHandler> = {
  handleApiStatus: handleApiStatus as RestHandler,
  handleApiServicesList: handleApiServicesList as RestHandler,
  handleApiServicesCreate: handleApiServicesCreate as RestHandler,
  handleApiServiceGet: handleApiServiceGet as RestHandler,
  handleApiServiceUpdate: handleApiServiceUpdate as RestHandler,
  handleApiServiceDelete: handleApiServiceDelete as RestHandler,
  handleApiServiceStart: handleApiServiceStart as RestHandler,
  handleApiServiceStop: handleApiServiceStop as RestHandler,
  handleApiServiceRestart: handleApiServiceRestart as RestHandler,
  handleApiServiceRebuild: handleApiServiceRebuild as RestHandler,
  handleApiReconcile: handleApiReconcile as RestHandler,
  handleApiLogsGet: handleApiLogsGet as RestHandler,
  handleApiLogsAnalytics: handleApiLogsAnalytics as RestHandler,
  handleApiOpenApi: handleApiOpenApi as RestHandler,
};

// Validate that all routes have registered handlers
for (const route of routes) {
  if (!restHandlers[route.handlerName]) {
    log("ERROR", `Missing handler for route: ${route.pattern} \u2192 ${route.handlerName}`);
  }
}

// Read request body with size limit
function readBody(req: IncomingMessage, cb: (body: string) => void, onError: (e: Error) => void): void {
  let body = "";
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      req.destroy();
      onError(new Error("Request body too large"));
      return;
    }
    body += chunk.toString();
  });
  req.on("end", () => cb(body));
  req.on("error", onError);
}

// Use readBody helper in request handlers
function withBody(req: IncomingMessage, res: ServerResponse, fn: (body: string) => void): void {
  readBody(req, (body) => {
    try {
      fn(body);
    } catch (e: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }, (e) => {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "tsx", timestamp: new Date().toISOString() }));
    return;
  }

  if (req.url === "/sudo" && req.method === "POST") {
    withBody(req, res, (body) => {
      const { password, command } = JSON.parse(body);
      if (!password || !command) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "password and command are required" }));
        return;
      }
      const pwBuf = Buffer.from(password);
      const adminBuf = Buffer.from(getAdminPassword());
      if (pwBuf.length !== adminBuf.length || !crypto.timingSafeEqual(pwBuf, adminBuf)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const output = execSync(`sudo -S ${command}`, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        input: getSudoPassword() + "\n",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ output: output.trim() }));
    });
    return;
  }

  if (req.url === "/status") {
    const runtime = loadRuntimeState();
    const uptime = Math.floor(
      (Date.now() - new Date(STATUS.startTime).getTime()) / 1000
    );
    const lastN = 50;
    const hasActiveErrors =
      STATUS.reconcileErrors.length > 0 ||
      STATUS.buildErrors.length > 0 ||
      STATUS.toolErrors.length > 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          healthy: !hasActiveErrors,
          uptime,
          startTime: STATUS.startTime,
          lastReconcile: STATUS.lastReconcile,
          reconcileCount: STATUS.reconcileCount,
          reconcileErrors: STATUS.reconcileErrors.slice(-lastN),
          buildErrors: STATUS.buildErrors,
          toolErrors: STATUS.toolErrors.slice(-lastN),
          cloudflaredError: STATUS.lastCloudflaredError,
          services: runtime,
        },
        null,
        2
      )
    );
    return;
  }

  const proxyMatch = req.url?.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (proxyMatch) {
    const serviceName = proxyMatch[1];
    const targetPath = proxyMatch[2] || "/";
    const runtime = getCachedRuntimeState();
    const svc = runtime[serviceName];
    if (!svc || !svc.port) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Service "${serviceName}" not found or not running`,
        })
      );
      return;
    }
    const options = {
      hostname: "localhost",
      port: svc.port,
      path: targetPath,
      method: req.method,
      headers: { ...(req.headers as Record<string, string>) },
    };
    delete (options as any).headers["host"];
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (e: any) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Proxy error for "${serviceName}": ${e.message}`,
        })
      );
    });
    req.pipe(proxyReq);
    return;
  }

  // --- REST API route dispatcher (declarative, from lib/routes.ts) ---
  const parsed = url.parse(req.url!, true);
  const pathname = parsed.pathname ?? "/";
  const query = (parsed.query as Record<string, string>) || {};

  const match = matchRoute(req.method!, pathname);
  if (match) {
    const handler = restHandlers[match.handlerName];
    if (handler) {
      handler(req, res, match.params, query);
      return;
    }
  }

  res.writeHead(404);
  res.end();
}

const httpServer = http.createServer(handleRequest);


httpServer.listen(MCP_PORT, "0.0.0.0", () => {
  log("INFO", `[mcp] TCP server listening on :${MCP_PORT}`);
});

const unixServer = http.createServer(handleRequest);
try {
  fs.unlinkSync(SOCKET_PATH);
} catch {
  /* empty */
}
unixServer.listen(SOCKET_PATH, () => {
  log("INFO", `[mcp] Unix socket listening on ${SOCKET_PATH}`);
});
