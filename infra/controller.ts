import { loadDesired } from "./lib/services";
import { sh, shCapture } from "./lib/podman";
import { collectSnapshot, getHistory } from "./lib/perf";
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

// ── Logger ──

/** Write a timestamped log line to stdout and the persistent controller.log file. */
function log(level: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  process.stdout.write(line + "\n");
  fs.appendFileSync(LOG_FILE, line + "\n");
}

/** Append raw data to the controller.log without timestamp (used by the console monkey-patch). */
function appendLog(data: string): void {
  try { fs.appendFileSync(LOG_FILE, data); } catch {}
}

// ── Console Patch ──

// Patch console so all main-thread console calls also go to the log file
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
console.log = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  origLog(...args);
  appendLog(msg + '\n');
};
console.error = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  origError(...args);
  appendLog(msg + '\n');
};
console.warn = (...args: any[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  origWarn(...args);
  appendLog(msg + '\n');
};

// Truncate log at startup to prevent unbounded growth
try { fs.writeFileSync(LOG_FILE, ""); } catch {}

log("INFO", "startup attempted");

// ── State ──

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

/** Run `npm test` in the infra directory. Returns true if all tests pass. */
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

// ── Test & Watch ──

function watchInfraDir(): void {
  const infraDir = path.join(__dirname);
  fs.watch(infraDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
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

// ── Graceful Shutdown ──

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

// ── Auth ──

// Lazy-load passwords so rotation doesn't require restart
function getAdminPassword(): string {
  return fs.readFileSync(ADMIN_PASSWORD_FILE, "utf-8").trim();
}
function getSudoPassword(): string {
  return fs.readFileSync(path.join(__dirname, ".sudo-password.txt"), "utf-8").trim();
}

watchInfraDir();

// ── Runtime State ──

/** Read runtime/services.json from disk. Returns empty object on read failure. */
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

// ── Worker Thread ──

function startWorker(): void {
  worker = new Worker(path.join(__dirname, "reconcile-worker.ts"), {
    stdout: true,
    stderr: true,
    execArgv: [
      "--require",
      path.join(__dirname, "node_modules/tsx/dist/cjs/index.cjs"),
    ],
  });

  (worker as any).stdout.on("data", (d: any) => {
    process.stdout.write(d);
    try { fs.appendFileSync(LOG_FILE, d); } catch {}
  });
  (worker as any).stderr.on("data", (d: any) => {
    process.stderr.write(d);
    try { fs.appendFileSync(LOG_FILE, d); } catch {}
  });

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

// ── Service CRUD ──

/** List all services with basic status info (name, port, running, exposed). */
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

/** Get the runtime state of a single service by name, or null if not found. */
function getServiceStatus(name: string): any {
  const runtime = loadRuntimeState();
  return runtime[name] || null;
}

/** Find the filesystem path to a service's config file (repo or desired).
 *  With multi-file support, the service name may differ from the directory
 *  name (e.g. "fuse-worker" lives in repos/fuse/agent-stack.worker.json),
 *  so we scan agent-stack*.json files when the simple path fails. */
function serviceFilePath(name: string): string | null {
  // Check desired/ first (systemd services)
  const desiredPath = path.join(DESIRED_DIR, `${name}.json`);
  if (fs.existsSync(desiredPath)) return desiredPath;

  // Fast path: check repos/<name>/ for an agent-stack*.json defining this service
  const nameDir = path.join(REPOS_DIR, name);
  if (fs.existsSync(nameDir)) {
    try {
      const files = fs.readdirSync(nameDir)
        .filter(f => f.startsWith("agent-stack") && f.endsWith(".json"));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(nameDir, f), "utf-8");
          if (JSON.parse(raw).name === name) return path.join(nameDir, f);
        } catch { /* parse error, skip */ }
      }
    } catch { /* unreadable dir, skip */ }
  }

  // Full scan: service name might differ from directory name
  // (e.g. "fuse-worker" defined in repos/fuse/agent-stack.worker.json)
  try {
    for (const entry of fs.readdirSync(REPOS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name === name) continue; // already checked above
      const repoDir = path.join(REPOS_DIR, entry.name);
      const configFiles = fs.readdirSync(repoDir)
        .filter(f => f.startsWith("agent-stack") && f.endsWith(".json"));
      for (const configFile of configFiles) {
        try {
          const raw = fs.readFileSync(path.join(repoDir, configFile), "utf-8");
          if (JSON.parse(raw).name === name) return path.join(repoDir, configFile);
        } catch { /* parse error, skip */ }
      }
    }
  } catch { /* REPOS_DIR unreadable */ }

  return null;
}

/**
 * Create a new service by writing an agent-stack.json into the repo directory.
 * Required: name, repo. Optional: port, host_port, auto_port, env, volumes, expose.
 *
 * The filename follows the multi-file convention:
 *   - If name matches the directory basename → agent-stack.json (primary)
 *   - Otherwise → agent-stack.<name>.json (secondary service)
 */
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

  // Determine filename by convention
  const repoDir = path.basename(repo);
  const filename = name === repoDir
    ? "agent-stack.json"
    : `agent-stack.${name}.json`;

  fs.writeFileSync(
    path.join(repo, filename),
    JSON.stringify(service, null, 2)
  );
  return `Created service ${name} in ${filename}`;
}

/**
 * Update an existing service's agent-stack.json fields.  Merges the new
 * values into the existing config.  Fields not provided are preserved.
 */
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

/** Delete a service by removing its config file.  The controller will GC the containers. */
function deleteService(name: string): string {
  const filepath = serviceFilePath(name);
  if (!filepath) throw new Error(`Service ${name} not found`);
  fs.unlinkSync(filepath);
  return `Deleted service ${name}`;
}

// ── Tool Error Tracking ──

/** Record a tool operation failure in the STATUS error list for API reporting. */
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

// ── Logs ──

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

// ── Service Lifecycle ──

/** Start a stopped container by name. */
function startService(name: string): string {
  try {
    sh(`podman start ${name}`);
    return `Started ${name}`;
  } catch (e: any) {
    trackToolError("start_service", { name }, e);
    throw e;
  }
}

/** Stop a running container by name. */
function stopService(name: string): string {
  try {
    sh(`podman stop ${name}`);
    return `Stopped ${name}`;
  } catch (e: any) {
    trackToolError("stop_service", { name }, e);
    throw e;
  }
}

/** Restart a container by name. */
function restartService(name: string): string {
  try {
    sh(`podman restart ${name}`);
    return `Restarted ${name}`;
  } catch (e: any) {
    trackToolError("restart_service", { name }, e);
    throw e;
  }
}

/**
 * Rebuild a service container by deleting its hash marker (forcing
 * a rebuild on next reconcile) and removing the running container.
 */
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

// ── Reconciliation ──

/**
 * Trigger a reconciliation cycle by posting a message to the worker thread.
 * Returns immediately — the worker processes asynchronously.
 */
function reconcile(): string {
  (worker as Worker).postMessage("reconcile");
  return "Reconciliation triggered";
}

// ── REST API Handler Functions ──

type RestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  query: Record<string, string>
) => void;

/**
 * GET /api/status — Return controller health + all service states.
 * Includes uptime, error lists, and runtime state snapshot.
 */
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

/**
 * GET /api/services — List all services with basic status info.
 */
function handleApiServicesList(
  req: IncomingMessage,
  res: ServerResponse
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(listServices(), null, 2));
}

/**
 * POST /api/services — Create a new service by writing agent-stack.json.
 */
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

/**
 * GET /api/services/:name — Get runtime state for a single service.
 */
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

/**
 * PUT /api/services/:name — Update an existing service's agent-stack.json.
 */
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

/**
 * DELETE /api/services/:name — Remove a service's config (GC handles cleanup).
 */
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

/**
 * POST /api/services/:name/start — Start a stopped container.
 */
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

/**
 * POST /api/services/:name/stop — Stop a running container.
 */
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

/**
 * POST /api/services/:name/restart — Restart a container.
 */
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

/**
 * POST /api/services/:name/rebuild — Force rebuild by deleting hash marker.
 */
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

/**
 * POST /api/reconcile — Trigger an immediate reconciliation cycle.
 */
function handleApiReconcile(
  req: IncomingMessage,
  res: ServerResponse
): void {
  const result = reconcile();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: result }));
}

/**
 * GET /api/logs/:name — Get container logs for a service.
 */
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

/**
 * POST /api/logs/analytics — Aggregated logs from multiple sources.
 */
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

/**
 * GET /api/openapi.json — Generate and return the OpenAPI 3.0 spec live.
 */
function handleApiOpenApi(
  req: IncomingMessage,
  res: ServerResponse
): void {
  // Always generated live from the declarative route registry
  const spec = buildOpenApiSpec();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(spec, null, 2));
}

/**
 * GET /api/perf — Return full performance history.
 */
function handleApiPerf(
  req: IncomingMessage,
  res: ServerResponse
): void {
  const history = getHistory();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(history, null, 2));
}

/**
 * POST /api/perf/collect — Trigger an immediate performance snapshot.
 */
function handleApiPerfCollect(
  req: IncomingMessage,
  res: ServerResponse
): void {
  try {
    const snapshot = collectSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ message: "Snapshot collected", snapshot }, null, 2)
    );
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ── Handler Registry ──

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
  handleApiPerf: handleApiPerf as RestHandler,
  handleApiPerfCollect: handleApiPerfCollect as RestHandler,
  handleApiOpenApi: handleApiOpenApi as RestHandler,
};

// ── Request Helpers ──

// ── Route Validation ──
// Verify that every route declared in the registry has a matching handler function.
// This catches typos and refactoring gaps at startup rather than at request time.
for (const route of routes) {
  if (!restHandlers[route.handlerName]) {
    log("ERROR", `Missing handler for route: ${route.pattern} → ${route.handlerName}`);
  }
}

// ── Body Reader ──
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

// ── Request Dispatcher ──

/**
 * Parse and validate request body with size limits, then pass to a callback.
 */
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

/**
 * Main HTTP request handler. Dispatches to ping, sudo, /status, proxy, or REST routes.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/ping") {
    // ── Ping / Health Check ──
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "tsx", timestamp: new Date().toISOString() }));
    return;
  }

  if (req.url === "/sudo" && req.method === "POST") {
    // ── Sudo Command Endpoint ──
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
    // ── Legacy Status Endpoint ──
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

  // ── Logo Endpoint ──
  const logoMatch = req.url?.match(/^\/logo\/([a-z][a-z0-9_-]*)$/i);
  if (logoMatch) {
    const name = logoMatch[1];
    // Two strategies: prefer config-defined logo in service repo, then fall back to logos/<name>.svg
    const desired = loadDesired();
    const svc = desired.find((s) => s.name === name);
    let svg: string | null = null;

    // Strategy 1: logo._type === "file" — read from service repo
    if (svc?.logo?._type === "file" && svc.repo && svc.logo.fileName) {
      const filePath = svc.logo.isRelative !== false
        ? path.join(svc.repo, svc.logo.fileName)
        : svc.logo.fileName;
      try {
        svg = fs.readFileSync(filePath, "utf-8");
      } catch { /* fall through */ }
    }

    // Strategy 2: fall back to logos/<name>.svg on disk
    if (!svg) {
      const logoPath = path.join(__dirname, "..", "logos", `${name}.svg`);
      try {
        svg = fs.readFileSync(logoPath, "utf-8");
      } catch { /* 404 */ }
    }

    if (svg) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
      res.end(svg);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Logo not found for "${name}"` }));
    }
    return;
  }

  // ── Proxy Endpoint ──
  const proxyMatch = req.url?.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (proxyMatch) {
    const serviceName = proxyMatch[1];
    const targetPath = proxyMatch[2] || "/";
    // Resolve the target service port from runtime state (most current port including slot state)
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

  // ── REST API Route Dispatch ──
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

// ── HTTP Server ──

/** TCP server for REST API and proxy endpoints (port 80 on host). */
const httpServer = http.createServer(handleRequest);


httpServer.listen(MCP_PORT, "0.0.0.0", () => {
  log("INFO", `[mcp] TCP server listening on :${MCP_PORT}`);
});

/** Unix domain socket server for local-only IPC (used by MCP shim). */
const unixServer = http.createServer(handleRequest);
try {
  fs.unlinkSync(SOCKET_PATH);
} catch {
  /* empty */
}
unixServer.listen(SOCKET_PATH, () => {
  log("INFO", `[mcp] Unix socket listening on ${SOCKET_PATH}`);
});

// ── Performance Collection ──

/**
 * Collect a performance snapshot and schedule the next collection (5-minute interval).
 * Uses recursive setTimeout rather than setInterval so that slow collection runs
 * (e.g. under load) don't overlap with the next scheduled run.
 * First collection is delayed 30 seconds after startup to let the system settle.
 */
function schedulePerfCollection(): void {
  try {
    collectSnapshot();
    log("INFO", "[perf] snapshot collected");
  } catch (e: any) {
    log("ERROR", `[perf] snapshot failed: ${e.message}`);
  }
  setTimeout(schedulePerfCollection, 5 * 60 * 1000);
}
setTimeout(schedulePerfCollection, 30_000); // first collection 30s after startup
