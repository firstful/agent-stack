/**
 * controller.ts — Main HTTP server, proxy, and reconciliation orchestrator for agent-stack.
 *
 * This module serves as the entry point for the agent-stack controller process.
 * Responsibilities:
 *   - HTTP server (port 80) for the REST API, host-based proxy, Dash UI, and logo serving
 *   - Unix domain socket server for local-only IPC (used by MCP shim)
 *   - Worker thread lifecycle (spawn, monitor, restart reconcile-worker.ts)
 *   - Service CRUD (create, read, update, delete) against agent-stack config files
 *   - Container lifecycle helpers (start, stop, restart, rebuild)
 *   - Performance snapshot collection (5-minute interval)
 *   - Auto-restart on source file changes (with test gate)
 *   - Log persistence to controller.log
 *   - Host-based HTTP reverse proxy with canary weighted routing
 *   - Rate limiting (per-IP sliding window)
 *   - WebSocket upgrade proxy
 *   - Canary 5xx metrics tracking (persisted for reconcile worker)
 *   - Dash UI (service overview dashboard at dash.ffilt.us)
 *   - Performance dashboard (/perf with Chart.js)
 *
 * All orchestration logic (build, deploy, slot swap) lives in lib/ modules;
 * this file only wires them together via REST handlers and the worker thread.
 */

// ── Imports ──

import { loadDesired } from "./lib/services";
import { sh, shCapture } from "./lib/podman";
import { collectSnapshot, getHistory } from "./lib/perf";
import { Worker } from "worker_threads";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import net from "net";
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
  RUNTIME_DIR,
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
  const watcher = fs.watch(infraDir, { recursive: true }, (eventType, filename) => {
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
  // Suppress EACCES errors from temp files the watcher can't access
  watcher.on("error", (err: any) => {
    if (err.code === "EACCES") return;
    log("WARN", `[watch] error: ${err.message}`);
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

// ── Route Validation ──
// Verify that every route declared in the registry has a matching handler function.
// This catches typos and refactoring gaps at startup rather than at request time.
for (const route of routes) {
  if (!restHandlers[route.handlerName]) {
    log("ERROR", `Missing handler for route: ${route.pattern} → ${route.handlerName}`);
  }
}

// ── Body Reader ──

/**
 * Read the request body with a size limit enforced by MAX_BODY_SIZE (1 MB).
 * Destroys the request if the body exceeds the limit to prevent OOM from
 * large payloads.  Calls back with the body string or an error.
 */
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

// ──────────────────────────────────────────────────────────────
//  PROXY / DASH UI / RATE LIMIT / CANARY METRICS
// ──────────────────────────────────────────────────────────────

const DASH_HOSTNAME = process.env.DASH_HOSTNAME || "dash.ffilt.us";
const UPSTREAM_TIMEOUT = 30_000; // 30s timeout for upstream requests
const CANARY_METRICS_FILE = path.join(RUNTIME_DIR, "canary-metrics.json");

// ── Rate Limiter ───────────────────────────────────────────

const rateLimitBuckets = new Map<string, { hits: number[]; blockedUntil: number }>();

function getClientIP(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    return xff.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).trim() || req.socket?.remoteAddress || "unknown";
  }
  return req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(name: string, svc: Record<string, any>, req: IncomingMessage): { status: number; retryAfter: number; message: string } | null {
  const cfg = svc.rateLimit;
  if (!cfg || !cfg.requestsPerMinute) return null;

  const ip = getClientIP(req);
  const key = `${name}:${ip}`;
  const now = Date.now();
  const windowMs = 60_000;
  const blockMs = cfg.blockDurationMs || 600_000;

  let entry = rateLimitBuckets.get(key);
  if (!entry) {
    entry = { hits: [], blockedUntil: 0 };
    rateLimitBuckets.set(key, entry);
  }

  // Check if currently blocked
  if (entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    return { status: 429, retryAfter, message: `Rate limited. Retry after ${retryAfter}s` };
  }

  // Prune expired hits
  entry.hits = entry.hits.filter(t => now - t < windowMs);

  // Check limit
  if (entry.hits.length >= cfg.requestsPerMinute) {
    entry.blockedUntil = now + blockMs;
    const retryAfter = Math.ceil(blockMs / 1000);
    return { status: 429, retryAfter, message: `Rate limited. Retry after ${retryAfter}s` };
  }

  // Record hit
  entry.hits.push(now);
  return null;
}

// Clean up stale bucket entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitBuckets) {
    if (entry.blockedUntil > 0 && entry.blockedUntil < now) {
      entry.blockedUntil = 0;
      entry.hits = [];
    }
    if (entry.blockedUntil === 0 && entry.hits.length === 0) {
      rateLimitBuckets.delete(key);
    }
  }
}, 300_000);

// ── Canary Metrics ──────────────────────────────────────────

interface CanaryMetric {
  slot: string;
  startTime: number;
  requests: number;
  errors5xx: number;
  lastActivity: number;
}

let canaryMetrics: Record<string, CanaryMetric> = {};

function initCanaryMetricsFromState(runtime: Record<string, any>): void {
  const next: Record<string, CanaryMetric> = {};
  for (const [name, svc] of Object.entries(runtime)) {
    if (svc && typeof svc === "object" && (svc as any).canary && (svc as any).canary.slot) {
      const existing = canaryMetrics[name];
      next[name] = {
        slot: (svc as any).canary.slot,
        startTime: (svc as any).canary.startTime || Date.now(),
        requests: existing ? existing.requests : 0,
        errors5xx: existing ? existing.errors5xx : 0,
        lastActivity: existing ? existing.lastActivity : Date.now(),
      };
    }
  }
  canaryMetrics = next;
}

// Initialize canary metrics from runtime state
initCanaryMetricsFromState(loadRuntimeState());

function persistCanaryMetrics(): void {
  const data = JSON.stringify(canaryMetrics, null, 2);
  try {
    fs.writeFileSync(CANARY_METRICS_FILE, data);
  } catch {
    // best effort — proxy must never block on metrics IO
  }
}

// Persist canary metrics every 5 seconds so the reconcile worker can read them
setInterval(persistCanaryMetrics, 5000);

// ── Host-based Routing ──────────────────────────────────────

/**
 * Resolve a hostname+url to a backend service target.
 *
 * Resolution order:
 *   1. Path-based routing: /proxy/:name/... (backward compat)
 *   2. Exact hostname match against svc.exposed
 *   3. Wildcard hostname match (svc.exposed starts with "*.")
 *   4. Additional hostnames array match (svc.hostnames)
 *
 * Returns { name, port, path } or null if no target found.
 */
function resolveTarget(urlPath: string, hostname: string, runtime: Record<string, any>): { name: string; port: number; path: string } | null {
  // 1. Path-based routing: /proxy/:name/...
  const pathMatch = urlPath.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (pathMatch) {
    const svc = runtime[pathMatch[1]];
    if (svc && svc.port) {
      return { name: pathMatch[1], port: svc.port, path: pathMatch[2] || "/" };
    }
  }

  if (!hostname) return null;

  // 2. Exact hostname match against svc.exposed
  for (const [name, svc] of Object.entries(runtime)) {
    if (svc && typeof svc === "object" && (svc as any).exposed === hostname && (svc as any).port) {
      return { name, port: (svc as any).port, path: urlPath };
    }
  }

  // 3. Wildcard hostname match
  for (const [name, svc] of Object.entries(runtime)) {
    if (svc && typeof svc === "object" && (svc as any).exposed && typeof (svc as any).exposed === "string" && (svc as any).exposed.startsWith("*.") && (svc as any).port) {
      const suffix = (svc as any).exposed.slice(1); // e.g. ".ffilt.us"
      if (hostname.endsWith(suffix)) {
        return { name, port: (svc as any).port, path: urlPath };
      }
    }
  }

  // 4. Additional hostnames array
  for (const [name, svc] of Object.entries(runtime)) {
    if (svc && typeof svc === "object" && (svc as any).port && (svc as any).hostnames && Array.isArray((svc as any).hostnames)) {
      for (const hn of (svc as any).hostnames) {
        if (hn === hostname) {
          return { name, port: (svc as any).port, path: urlPath };
        }
        if (typeof hn === "string" && hn.startsWith("*.") && hostname.endsWith(hn.slice(1))) {
          return { name, port: (svc as any).port, path: urlPath };
        }
      }
    }
  }

  return null;
}

// ── Reverse Proxy ──────────────────────────────────────────

/**
 * Proxy an HTTP request to a backend service, with canary weighted routing.
 */
function proxyTo(
  targetPath: string,
  targetPort: number,
  upstreamHost: string,
  req: IncomingMessage,
  res: ServerResponse,
  serviceName: string,
  runtime: Record<string, any>
): void {
  // ── Canary weighted routing ──
  let backendPort = targetPort;
  let isCanary = false;
  if (serviceName && runtime[serviceName] && runtime[serviceName].canary) {
    const svc = runtime[serviceName];
    const w = svc.canary.weight || 0.1;
    const canarySlot = svc.canary.slot;
    const canaryPort = svc.slots?.[canarySlot]?.port;
    if (canaryPort && Math.random() < w) {
      backendPort = canaryPort;
      isCanary = true;
    }
  }

  // Rewrite CouchDB server-level paths when database prefix is in the URL
  let finalPath = targetPath;
  if (finalPath.startsWith("/obsidian-vault/_node/")) {
    finalPath = finalPath.replace("/obsidian-vault", "");
  }

  const opts: http.RequestOptions = {
    hostname: upstreamHost,
    port: backendPort,
    path: finalPath,
    method: req.method,
    headers: { ...(req.headers as Record<string, string | string[] | undefined>) },
    timeout: UPSTREAM_TIMEOUT,
  };

  let responded = false;

  const proxyReq = http.request(opts, (proxyRes) => {
    if (responded) return;
    responded = true;

    // ── Track canary 5xx errors ──
    if (isCanary && serviceName) {
      const svcState = runtime[serviceName];
      if (!canaryMetrics[serviceName]) {
        canaryMetrics[serviceName] = {
          slot: svcState?.canary?.slot || "?",
          startTime: svcState?.canary?.startTime || Date.now(),
          requests: 0,
          errors5xx: 0,
          lastActivity: Date.now(),
        };
      }
      canaryMetrics[serviceName].requests++;
      if (proxyRes.statusCode && proxyRes.statusCode >= 500) {
        canaryMetrics[serviceName].errors5xx++;
      }
      canaryMetrics[serviceName].lastActivity = Date.now();
    }

    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy(new Error("Upstream timeout"));
  });

  proxyReq.on("error", (e: any) => {
    if (responded) return;
    responded = true;

    const status = e.message === "Upstream timeout" ? 504 : 502;
    const body = JSON.stringify({ error: `Proxy error: ${e.message}` });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  });

  req.pipe(proxyReq);
}

// ── WebSocket Upgrade Handler ───────────────────────────────

/**
 * Handle WebSocket upgrade requests for host-based proxied services.
 * Resolves the target service from the runtime state, creates a proxy
 * request to the backend, and pipes the raw TCP socket bidirectionally.
 * Without writing the 101 Switching Protocols response, cloudflared sees
 * raw WebSocket frames (e.g. "85 00" = PING) and errors with "malformed
 * HTTP response".
 */
function handleUpgrade(req: IncomingMessage, socket: net.Socket, head: Buffer): void {
  const hostname = (req.headers["host"] || "") as string;
  const runtime = getCachedRuntimeState();
  const target = resolveTarget(req.url || "/", hostname, runtime);
  if (!target) {
    socket.destroy();
    return;
  }

  const opts: http.RequestOptions = {
    hostname: "localhost",
    port: target.port,
    path: target.path,
    method: "GET",
    headers: req.headers,
  };

  const proxyReq = http.request(opts);
  proxyReq.on("upgrade", (proxyRes, proxySocket) => {
    // Write the 101 Switching Protocols response headers back to the
    // downstream client so cloudflared knows the WebSocket upgrade succeeded.
    // Without this, cloudflared sees raw WebSocket frames ("85 00" = PING)
    // and errors with "malformed HTTP response".
    const statusLine = "HTTP/1.1 101 Switching Protocols\r\n";
    const rawHeaders = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    socket.write(statusLine + rawHeaders + "\r\n\r\n");

    proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
}

// ── Logo Rendering ──────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = { healthy: "#22c55e", degraded: "#eab308", down: "#ef4444" };
const LOGO_COLORS: Record<string, string> = {
  opencode: "#8b5cf6",
  "kilocode-web": "#3b82f6",
  dash: "#22c55e",
  appflowy: "#14b8a6",
  cockpit: "#f97316",
  "free-llm-router": "#a855f7",
  "marp-editor": "#ec4899",
  "no-service": "#64748b",
  "personal-blog": "#eab308",
  techdeck: "#0ea5e9",
};

const LOGO_ICONS: Record<string, string> = {
  opencode: '<path d="M10 22l6-6-6-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 22h4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>',
  "kilocode-web": '<path d="M12 10l4 2-4 2" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 10l4 2-4 2" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  dash: '<rect x="5" y="5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="18" y="5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="5" y="18" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="18" y="18" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/>',
  appflowy: '<path d="M10 24V8l12 16V8" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  cockpit: '<circle cx="16" cy="16" r="10" stroke="white" stroke-width="1.8" fill="none"/><path d="M8 16h16" stroke="white" stroke-width="1.8"/><path d="M16 8v16" stroke="white" stroke-width="1.8"/><circle cx="16" cy="16" r="3" fill="white"/>',
  "free-llm-router": '<circle cx="16" cy="8" r="2.5" fill="white"/><circle cx="8" cy="22" r="2.5" fill="white"/><circle cx="24" cy="22" r="2.5" fill="white"/><path d="M16 10.5l-6 9" stroke="white" stroke-width="1.5"/><path d="M16 10.5l6 9" stroke="white" stroke-width="1.5"/>',
  "marp-editor": '<rect x="5" y="6" width="22" height="18" rx="2" stroke="white" stroke-width="1.8" fill="none"/><path d="M5 14h22" stroke="white" stroke-width="1.8"/><circle cx="9" cy="10" r="1" fill="white"/><circle cx="13" cy="10" r="1" fill="white"/><circle cx="17" cy="10" r="1" fill="white"/>',
  "no-service": '<circle cx="16" cy="16" r="9" stroke="white" stroke-width="1.8" fill="none"/><path d="M8 8l16 16" stroke="white" stroke-width="1.8"/>',
  "personal-blog": '<path d="M8 22V6l8 5 8-5v16" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  techdeck: '<path d="M6 10h20" stroke="white" stroke-width="2.2" stroke-linecap="round"/><path d="M6 16h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/><path d="M6 22h8" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
};

/**
 * Generate an SVG logo for a service.  Uses named logo config from
 * LOGO_ICONS when a matching entry exists, otherwise produces a generic
 * "</>" code icon.  The background colour is drawn from LOGO_COLORS.
 * @param name - Service name (used to look up icon and colour)
 * @returns SVG markup string for inline embedding
 */
function getLogoSvg(name: string): string {
  const color = LOGO_COLORS[name] || "#334155";
  const icon = LOGO_ICONS[name];
  if (icon) {
    return `<svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>${icon}</svg>`;
  }
  return `<svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="monospace" font-size="11" font-weight="bold">&lt;/&gt;</text></svg>`;
}

// ── Dash UI Helpers ────────────────────────────────────────

/** Get enriched service data for Dash UI, combining desired config with runtime state. */
function getDashServices(): any[] {
  const runtime = loadRuntimeState();
  const desired = loadDesired();
  return desired.map((s) => {
    const rt = runtime[s.name] || {};
    return {
      name: s.name,
      container: s.container,
      service: s.service,
      expose: s.expose,
      repo: s.repo,
      running: rt.running || false,
      port: rt.port || s.container?.host_port || s.container?.port || s.service?.port,
      sidecars: rt.sidecars,
      logo: s.logo,
    };
  });
}

/** Compute health data for the Dash UI health banner. */
function getDashHealth(): any {
  const uptime = Math.floor((Date.now() - new Date(STATUS.startTime).getTime()) / 1000);
  const errors = [
    ...STATUS.reconcileErrors as any[],
    ...STATUS.buildErrors as any[],
    ...STATUS.toolErrors as any[],
  ];
  return {
    healthy: errors.length === 0 && !STATUS.lastCloudflaredError,
    uptime,
    startTime: STATUS.startTime,
    lastReconcile: STATUS.lastReconcile,
    reconcileCount: STATUS.reconcileCount,
    errors,
    cloudflaredError: STATUS.lastCloudflaredError,
  };
}

// ── Dash UI Rendering ──────────────────────────────────────

/**
 * Render an individual service card for the Dash UI HTML page.
 * Includes: logo, name, type badge, status dot, port, URL, repo path,
 * sidecar list, and health status label.
 * @param svc - Enriched service data object from getDashServices()
 * @param status - Health status string ("healthy", "degraded", "down")
 * @returns HTML string for one card element
 */
function renderCard(svc: any, status: string): string {
  const name = svc.name || "unknown";
  const port = svc.container?.port || svc.service?.port || null;
  const hostname = svc.expose?.hostname || null;
  const svcUrl = hostname ? `https://${hostname}` : null;
  const color = STATUS_COLORS[status] || "#94a3b8";
  const hostLabel = hostname && hostname !== "*" ? hostname : null;
  const logo = getLogoSvg(name);
  let sidecarsHtml = "";
  if (svc.sidecars) {
    const entries = Object.entries(svc.sidecars);
    if (entries.length > 0) {
      const rows = entries.map(([scName, sc]: [string, any]) => {
        const scColor = sc.running ? STATUS_COLORS.healthy : STATUS_COLORS.down;
        return `<div class="sidecar-row">
          <span class="status-dot" style="background:${scColor};width:7px;height:7px"></span>
          <span class="sidecar-name">${scName}</span>
          ${sc.port ? `<span class="sidecar-port">:${sc.port}</span>` : ""}
        </div>`;
      }).join("");
      sidecarsHtml = `<div class="sidecars-section">
        <div class="sidecars-title">Sidecars</div>
        ${rows}
      </div>`;
    }
  }

  const typeLabel = !port && svc.service ? "systemd" : port ? "container" : "";
  return `<div class="card">
    <div class="card-header">
      ${logo}
      <div class="card-title-row">
        <h2>${name}</h2>
        ${typeLabel ? `<span class="type-badge">${typeLabel}</span>` : ""}
        <span class="status-dot" style="background:${color}"></span>
      </div>
    </div>
    <div class="card-body">
      ${port ? `<div class="info"><span class="label">Port</span><span class="value">${port}</span></div>` : ""}
      ${hostLabel ? `<div class="info"><span class="label">URL</span><a href="${svcUrl}" target="_blank">${hostLabel}</a></div>` : ""}
      ${svc.repo ? `<div class="info"><span class="label">Repo</span><span class="value mono">${svc.repo}</span></div>` : ""}
      ${!port && !hostLabel && !svc.repo ? `<div class="info"><span class="label">Type</span><span class="value">${svc.service ? "systemd" : "container"}</span></div>` : ""}
      ${sidecarsHtml}
    </div>
    <div class="card-footer">
      <span class="status-label ${status}">${status}</span>
    </div>
  </div>`;
}

/**
 * Render the health banner for the Dash UI.  Shows controller status,
 * uptime, last reconcile time, and any active errors or tunnel issues.
 * @param health - Health data from getDashHealth()
 * @returns HTML string for the banner element
 */
function renderHealthBanner(health: any): string {
  if (!health) return "";
  const errorCount = health.errors ? health.errors.length : 0;
  const cfError = health.cloudflaredError;
  const healthyFlag = health.healthy && errorCount === 0 && !cfError;
  const bg = healthyFlag ? "#064e3b" : "#7f1d1d";
  const border = healthyFlag ? "#22c55e" : "#ef4444";
  const text = healthyFlag ? "#a7f3d0" : "#fecaca";
  const ico = healthyFlag ? "&#10003;" : "&#9888;";
  let details = `<span class="health-label">Controller ${healthyFlag ? "healthy" : "unhealthy"}</span>`;
  details += ` &middot; <span class="health-meta">uptime ${Math.floor((health.uptime || 0) / 60)}m</span>`;
  details += ` &middot; <span class="health-meta">reconciles: ${health.reconcileCount || 0}</span>`;
  if (health.lastReconcile) {
    const ago = Math.floor((Date.now() - new Date(health.lastReconcile).getTime()) / 1000);
    details += ` &middot; <span class="health-meta">last reconcile ${ago}s ago</span>`;
  }
  if (errorCount) {
    details += ` &middot; <span class="health-error">${errorCount} error${errorCount > 1 ? "s" : ""}</span>`;
  }
  if (cfError) {
    details += ` &middot; <span class="health-error">tunnel error</span>`;
  }
  return `<div class="health-banner" style="background:${bg};border-color:${border};color:${text}">
    <span class="health-icon">${ico}</span>
    ${details}
  </div>`;
}

/**
 * Render the performance dashboard HTML page (Chart.js single-page app).
 * Serves as a standalone page at /perf with real-time system metrics,
 * container statistics, and top processes.
 * @returns Complete HTML document string
 */
function renderPerfHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dash — Performance</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui,-apple-system,sans-serif; background:#0b1121; color:#c9d1d9; margin:0; padding:1rem; }
  h1 { font-size:1.4rem; margin:0 0 1rem; color:#e6edf3; }
  nav { display:flex; gap:1rem; margin-bottom:1rem; font-size:0.85rem; }
  nav a { color:#94a3b8; text-decoration:none; }
  nav a.active { color:#60a5fa; font-weight:600; }
  .range { display:flex; gap:.5rem; margin-bottom:1rem; }
  .range button { background:#21262d; border:1px solid #30363d; color:#c9d1d9; padding:.35rem .9rem; border-radius:6px; cursor:pointer; font-size:.85rem; }
  .range button.active { background:#1f6feb; border-color:#1f6feb; color:#fff; }
  .chart-wrap { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:1rem; height:340px; position:relative; margin-bottom:1rem; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
  @media (max-width:900px){ .grid { grid-template-columns:1fr; } }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:1rem; }
  .card h2 { font-size:1rem; margin:0 0 .6rem; color:#8b949e; display:flex; align-items:center; gap:.4rem; }
  table { width:100%; border-collapse:collapse; font-size:.8rem; }
  th,td { text-align:left; padding:.35rem .5rem; }
  th { color:#8b949e; border-bottom:1px solid #30363d; cursor:pointer; user-select:none; }
  th:hover { color:#c9d1d9; }
  td { border-bottom:1px solid #21262d; }
  tr:hover td { background:#1c2128; }
  .bar { height:3px; background:#30363d; border-radius:2px; overflow:hidden; margin-top:3px; }
  .bar-fill { height:100%; background:#58a6ff; border-radius:2px; }
  .bar-fill.mem { background:#3fb950; }
  .right { text-align:right; }
  .muted { color:#8b949e; }
  .small { font-size:.75rem; }
</style>
</head>
<body>
<h1>Performance Dashboard</h1>
<nav>
  <a href="/">Overview</a>
  <a href="/perf" class="active">Performance</a>
</nav>
<div class="range" id="range">
  <button class="active" data-hours="1">1h</button>
  <button data-hours="6">6h</button>
  <button data-hours="24">24h</button>
</div>
<div class="chart-wrap">
  <canvas id="perfChart"></canvas>
</div>
<div class="grid">
  <div class="card">
    <h2>Top Containers</h2>
    <table id="containersTable">
      <thead><tr><th>Name</th><th class="right" data-sort="cpu">CPU %</th><th class="right" data-sort="mem">Mem %</th><th class="right">Net IO</th><th class="right">Block IO</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <div class="card">
    <h2>Top Processes</h2>
    <table id="processesTable">
      <thead><tr><th class="right">PID</th><th>Command</th><th class="right" data-sort="cpu">CPU %</th><th class="right" data-sort="mem">Mem %</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
</div>
<script>
(function(){
  let chart = null;
  let currentHours = 1;
  let containerSort = 'cpu';
  let processSort = 'cpu';
  let allData = { snapshots: [] };

  async function fetchData() {
    try {
      const res = await fetch('/api/perf');
      allData = await res.json();
      render();
    } catch (e) { console.error('fetch failed', e); }
  }

  function filterSnapshots(hours) {
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    return allData.snapshots.filter(s => s.system.ts >= cutoff);
  }

  function fmtKB(kb) {
    if (kb >= 1024 * 1024) return (kb / (1024 * 1024)).toFixed(2) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(2) + ' MB';
    return kb.toFixed(1) + ' KB';
  }

  function renderChart(snapshots) {
    const ctx = document.getElementById('perfChart').getContext('2d');
    const labels = snapshots.map(s => {
      const d = new Date(s.system.ts);
      return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    });
    const cpu = snapshots.map(s => s.system.cpuPercent);
    const mem = snapshots.map(s => s.system.memPercent);
    const diskR = snapshots.map(s => s.system.diskReadKBps);
    const diskW = snapshots.map(s => s.system.diskWriteKBps);
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'CPU %', data: cpu, borderColor: '#58a6ff', backgroundColor: '#58a6ff', tension: 0.3, pointRadius: 1 },
          { label: 'Mem %', data: mem, borderColor: '#3fb950', backgroundColor: '#3fb950', tension: 0.3, pointRadius: 1 },
          { label: 'Disk Read KB/s', data: diskR, borderColor: '#a371f7', backgroundColor: '#a371f7', tension: 0.3, pointRadius: 1, hidden: true },
          { label: 'Disk Write KB/s', data: diskW, borderColor: '#f0883e', backgroundColor: '#f0883e', tension: 0.3, pointRadius: 1, hidden: true },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#c9d1d9' } } },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 12 }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, suggestedMin: 0, suggestedMax: 100 }
        }
      }
    });
  }

  function maxVal(arr, key) {
    return Math.max(...arr.map(x => x[key] || 0), 0.01);
  }

  function renderContainers(snapshot) {
    const tbody = document.querySelector('#containersTable tbody');
    const data = [...snapshot.containers].sort((a,b) => b[containerSort + 'Percent'] - a[containerSort + 'Percent']).slice(0, 20);
    const maxCpu = maxVal(data, 'cpu');
    const maxMem = maxVal(data, 'mem');
    tbody.innerHTML = data.map(c => {
      const cpuBar = '<div class="bar"><div class="bar-fill" style="width:' + Math.min(100, (c.cpuPercent / maxCpu) * 100) + '%"></div></div>';
      const memBar = '<div class="bar"><div class="bar-fill mem" style="width:' + Math.min(100, (c.memPercent / maxMem) * 100) + '%"></div></div>';
      return '<tr><td>' + escapeHtml(c.name) + '</td><td class="right">' + c.cpuPercent.toFixed(1) + cpuBar + '</td><td class="right">' + c.memPercent.toFixed(1) + memBar + '</td><td class="right muted small">' + fmtKB(c.netInKB) + ' / ' + fmtKB(c.netOutKB) + '</td><td class="right muted small">' + fmtKB(c.blockInKB) + ' / ' + fmtKB(c.blockOutKB) + '</td></tr>';
    }).join('');
  }

  function renderProcesses(snapshot) {
    const tbody = document.querySelector('#processesTable tbody');
    const data = [...snapshot.topCpuProcesses].sort((a,b) => b[processSort + 'Percent'] - a[processSort + 'Percent']).slice(0, 20);
    const maxCpu = maxVal(data, 'cpu');
    const maxMem = maxVal(data, 'mem');
    tbody.innerHTML = data.map(p => {
      const cpuBar = '<div class="bar"><div class="bar-fill" style="width:' + Math.min(100, (p.cpuPercent / maxCpu) * 100) + '%"></div></div>';
      const memBar = '<div class="bar"><div class="bar-fill mem" style="width:' + Math.min(100, (p.memPercent / maxMem) * 100) + '%"></div></div>';
      return '<tr><td class="right muted">' + p.pid + '</td><td>' + escapeHtml(p.command) + '</td><td class="right">' + p.cpuPercent.toFixed(1) + cpuBar + '</td><td class="right">' + p.memPercent.toFixed(1) + memBar + '</td></tr>';
    }).join('');
  }

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function render() {
    const snaps = filterSnapshots(currentHours);
    if (snaps.length === 0) return;
    renderChart(snaps);
    const latest = snaps[snaps.length - 1];
    renderContainers(latest);
    renderProcesses(latest);
  }

  document.getElementById('range').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#range button').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentHours = parseInt(e.target.dataset.hours, 10);
    render();
  });

  document.getElementById('containersTable').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    containerSort = th.dataset.sort;
    render();
  });

  document.getElementById('processesTable').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    processSort = th.dataset.sort;
    render();
  });

  fetchData();
  setInterval(fetchData, 30000);
})();
</script>
</body>
</html>`;
}

/**
 * Render the main Dash UI HTML page (service overview cards).
 * Combines service cards, health banner, and optional "unknown host" notice.
 * @param services - Enriched service data array from getDashServices()
 * @param statusMap - service name → health status string
 * @param health - Health data from getDashHealth()
 * @param unknownHost - Hostname that didn't match any configured service, or null
 * @returns Complete HTML document string
 */
function renderHTML(services: any[], statusMap: Record<string, string>, health: any, unknownHost: string | null): string {
  const cards = services.map((svc) => {
    const name = svc.name || "unknown";
    return renderCard(svc, statusMap[name] || "unknown");
  }).join("");
  const banner = renderHealthBanner(health);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dash — Service Overview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { margin-bottom: 1.5rem; }
    header h1 { font-size: 1.75rem; font-weight: 700; }
    header p { color: #94a3b8; margin-top: 0.15rem; font-size: 0.875rem; }
    .health-banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem; border: 1px solid; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.8rem; flex-wrap: wrap; }
    .health-icon { font-size: 1rem; font-weight: bold; }
    .health-label { font-weight: 600; }
    .health-meta { opacity: 0.8; }
    .health-error { color: #fca5a5; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem; transition: border-color 0.2s; }
    .card:hover { border-color: #475569; }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .logo { width: 36px; height: 36px; flex-shrink: 0; border-radius: 7px; }
    .card-title-row { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; }
    .card-title-row h2 { font-size: 1.1rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .card-body { display: flex; flex-direction: column; gap: 0.4rem; }
    .info { display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; }
    .label { color: #64748b; }
    .value { color: #cbd5e1; }
    .value.mono { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.78rem; }
    .info a { color: #60a5fa; text-decoration: none; }
    .info a:hover { text-decoration: underline; }
    .card-footer { margin-top: 0.75rem; padding-top: 0.65rem; border-top: 1px solid #334155; }
    .status-label { display: inline-block; padding: 0.2em 0.7em; border-radius: 999px; font-size: 0.75rem; font-weight: 600; text-transform: capitalize; }
    .status-label.healthy { background: rgba(34,197,94,0.15); color: #22c55e; }
    .status-label.degraded { background: rgba(234,179,8,0.15); color: #eab308; }
    .status-label.down { background: rgba(239,68,68,0.15); color: #ef4444; }
    .type-badge { font-size: 0.65rem; font-weight: 600; padding: 0.1em 0.5em; border-radius: 4px; background: #334155; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.4; }
    .sidecars-section { margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px solid #334155; }
    .sidecars-title { font-size: 0.7rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.3rem; }
    .sidecar-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; padding: 0.15rem 0; color: #94a3b8; }
    .sidecar-name { color: #cbd5e1; }
    .sidecar-port { color: #64748b; margin-left: auto; font-family: "SF Mono", "Fira Code", monospace; font-size: 0.75rem; }
    .empty { text-align: center; padding: 4rem 2rem; color: #64748b; }
    .empty h2 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #94a3b8; }
    footer { text-align: center; margin-top: 3rem; color: #475569; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Dash</h1>
      <p>Service overview &amp; status</p>
    </header>
    <nav style="display:flex;gap:1rem;margin-bottom:1rem;font-size:0.85rem">
      <a href="/" style="color:#60a5fa;text-decoration:none;font-weight:600">Overview</a>
      <a href="/perf" style="color:#94a3b8;text-decoration:none">Performance</a>
    </nav>
    ${unknownHost ? `<div style="background:#1e1b4b;border:1px solid #6366f1;color:#c7d2fe;padding:0.75rem 1rem;border-radius:8px;margin-bottom:1.5rem;font-size:0.9rem;display:flex;align-items:center;gap:0.5rem">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      <span><strong>${unknownHost}</strong> is not a configured service</span>
    </div>` : ""}
    ${banner}
    ${services.length === 0
      ? `<div class="empty"><h2>No services found</h2><p>Check controller connection</p></div>`
      : `<div class="grid">${cards}</div>`
    }
    <footer>dash.ffilt.us</footer>
  </div>
</body>
</html>`;
}

// ── Main Request Handler ────────────────────────────────────

/**
 * Main HTTP request handler. Dispatches in order:
 *   1. Dash hostname → Dash UI
 *   2. Built-in endpoints (/ping, /sudo, /status, /logo/:name)
 *   3. Path-based proxy (/proxy/:name/...)
 *   4. REST API routes (/api/*)
 *   5. Host-based routing (resolve target → rate limit → proxy)
 *   6. Fallback → Dash UI (shows unknown host banner if unrecognized hostname)
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const hostname = (req.headers["host"] || "") as string;

  // Determine if this request targets the controller itself (API surface exposed).
  // Unix-socket requests have no Host header; treat them as local.
  const isLocalController =
    !hostname ||
    hostname === "localhost" ||
    hostname.startsWith("127.0.0.1") ||
    hostname === "controller.ffilt.us";

  const isDash = hostname === DASH_HOSTNAME;

  // ── Host-based Routing (service hostnames) ──              ─┐
  // MUST run before REST API dispatch so that requests like    │
  // `groceries.ffilt.us/api/status` reach the groceries        │
  // backend, not the controller API.                           │
  // Controller-local and Dash requests skip this block and     │
  // fall through to the API surface below.                     │
  if (!isLocalController && !isDash && hostname) {
    const runtime = getCachedRuntimeState();
    const target = resolveTarget(req.url || "/", hostname, runtime);
    if (target) {
      const svc = runtime[target.name];
      const rl = svc ? checkRateLimit(target.name, svc, req) : null;
      if (rl) {
        res.writeHead(429, {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfter),
          "X-RateLimit-Reset": String(rl.retryAfter),
        });
        res.end(JSON.stringify({ error: rl.message }));
        return;
      }
      proxyTo(target.path, target.port, "localhost", req, res, target.name, runtime);
      return;
    }
    // Unrecognized hostname → Dash UI with warning banner
    handleDashUI(req, res, hostname);
    return;
  }

  // ── Controller-local ───────────────────────────────────────┐
  // Everything below this point is only reachable via:          │
  //   - Unix socket (no Host header)                            │
  //   - localhost / 127.0.0.1                                  │
  //   - controller.ffilt.us                                    │
  //   - dash.ffilt.us (Dash UI)                                │
  // Service hostnames are handled above and never reach here.   │

  // ── Dash UI (dash.ffilt.us) ──
  if (isDash) {
    handleDashUI(req, res, null);
    return;
  }

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

  // ── Path-based Proxy (backward compat, controller-local only) ──
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
    proxyTo(targetPath, svc.port, "localhost", req, res, serviceName, runtime);
    return;
  }

  // ── REST API Route Dispatch (controller-local only) ──
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

  // ── Fallback: serve Dash UI ──
  handleDashUI(req, res, null);
}

// ── Dash UI Request Handler ─────────────────────────────────

/**
 * Serve Dash UI routes: /health (health check), /perf (performance page),
 * /api/services (JSON data endpoint), and / (main HTML overview page).
 * When an unrecognised hostname is passed as unknownHost, renders the
 * main page with a warning banner.
 */
function handleDashUI(req: IncomingMessage, res: ServerResponse, unknownHost: string | null): void {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Perf dashboard page
  if (req.url === "/perf") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderPerfHTML());
    return;
  }

  // Enriched services API (used by Dash UI client)
  const services = getDashServices();
  const names = services.map((s) => s.name).filter(Boolean);
  const statusMap: Record<string, string> = {};
  for (const svc of services) {
    statusMap[svc.name] = svc.running ? "healthy" : "down";
  }
  const health = getDashHealth();

  if (req.url === "/api/services") {
    const enriched = services.map((svc) => ({
      ...svc,
      _status: statusMap[svc.name] || "unknown",
      _logo: getLogoSvg(svc.name),
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(enriched));
    return;
  }

  // Main Dash overview page
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(renderHTML(services, statusMap, health, unknownHost));
}

// ── HTTP Server ──

/** TCP server for REST API, proxy, and Dash UI (port 80 on host). */
const httpServer = http.createServer(handleRequest);

// WebSocket upgrade handler (raw TCP proxy for cloudflared compatibility)
httpServer.on("upgrade", handleUpgrade);

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
