#!/usr/bin/env node
/**
 * marketplace.ffilt.us — Red Thread Module Marketplace
 *
 * Serves the module catalogue for downloadable story packs and engine
 * bundles.  Modules are versioned, carry minShellVersion compatibility
 * constraints, and are distributed as zip archives for the client to
 * extract into the local bundles/ directory.
 *
 * Endpoints:
 *   GET /api/catalogue
 *       — Returns the full module catalogue with latest versions.
 *   GET /api/catalogue?shell=2
 *       — Filter to only modules compatible with shell version 2+.
 *   GET /api/modules/:id
 *       — Returns metadata for a specific module.
 *   GET /api/modules/:id/download
 *       — Downloads the module zip archive.
 *   GET /api/modules/:id/version.json
 *       — Version manifest for OTA-style update checks.
 *
 * Module storage layout under MODULES_DIR/:
 *   modules/
 *     caesar/
 *       manifest.json    — BundleManifest-format metadata
 *       main.js          — Entry point
 *       assets/          — Story JSON, images, etc.
 *       module.zip       — Pre-bundled zip for download
 *     stardew/
 *       ...
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

const PORT = parseInt(process.env.PORT || '3652', 10);
const HOST = process.env.HOST || '0.0.0.0';
const MODULES_DIR = path.resolve(process.env.MODULES_DIR || '/srv/files/modules');
const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'Red Thread Marketplace';

// ── Telemetry Configuration ─────────────────────────────────────────────────
const TELEMETRY_DIR = process.env.TELEMETRY_DIR || '/srv/telemetry';
const MAX_TELEMETRY_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per daily file
try { fs.mkdirSync(TELEMETRY_DIR, { recursive: true }); } catch {}

// ── Utilities ──────────────────────────────────────────────────────────────

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function errorResponse(res, status, message) {
  jsonResponse(res, status, { error: message });
}

function safePath(segments) {
  // Resolve and ensure we stay within MODULES_DIR
  const full = path.resolve(MODULES_DIR, ...segments);
  if (!full.startsWith(MODULES_DIR + path.sep) && full !== MODULES_DIR) {
    return null;
  }
  return full;
}

// ── Module Manifest Loading ───────────────────────────────────────────────

const MANIFEST_CACHE = new Map();
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Read a module's manifest.json.  Returns null if the module or manifest
 * doesn't exist.  Cached for CACHE_TTL ms to avoid hammering disk on
 * catalogue requests.
 */
function loadManifest(moduleId) {
  const cached = MANIFEST_CACHE.get(moduleId);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return cached.data;
  }

  const manifestPath = safePath([moduleId, 'manifest.json']);
  if (!manifestPath) return null;

  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    MANIFEST_CACHE.set(moduleId, { data, ts: Date.now() });
    return data;
  } catch {
    MANIFEST_CACHE.delete(moduleId);
    return null;
  }
}

/**
 * List all available modules by scanning the modules directory.
 */
function listModules() {
  try {
    const entries = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(id => loadManifest(id) !== null);
  } catch {
    return [];
  }
}

/**
 * Build the full catalogue — array of module metadata dicts.
 */
function buildCatalogue(shellFilter) {
  const ids = listModules();
  const result = [];

  for (const id of ids) {
    const mf = loadManifest(id);
    if (!mf) continue;

    // Apply shell version filter
    if (shellFilter !== undefined && shellFilter !== null) {
      const minVer = mf.minShellVersion || 1;
      if (minVer > shellFilter) continue;
    }

    // Compute file size from zip if available
    const zipPath = safePath([id, 'module.zip']);
    let size = null;
    try {
      if (zipPath) {
        const stat = fs.statSync(zipPath);
        size = stat.size;
      }
    } catch { /* zip not built yet */ }

    result.push({
      id: mf.id || id,
      name: mf.name || id,
      version: mf.version || '0.0.0',
      entry: mf.entry || 'main.js',
      minShellVersion: mf.minShellVersion || 1,
      permissions: mf.permissions || [],
      description: mf.description || '',
      metadata: mf.metadata || {},
      size: size,
    });
  }

  return result;
}

// ── Route Handlers ─────────────────────────────────────────────────────────

function handleCatalogue(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const shellParam = url.searchParams.get('shell');
  const shellFilter = shellParam ? parseInt(shellParam, 10) : undefined;

  const modules = buildCatalogue(shellFilter);
  jsonResponse(res, 200, {
    marketplace: MARKETPLACE_NAME,
    shellVersion: shellFilter || 'all',
    count: modules.length,
    modules,
  });
}

function handleModuleDetail(req, res, moduleId) {
  const mf = loadManifest(moduleId);
  if (!mf) {
    return errorResponse(res, 404, `Module not found: ${moduleId}`);
  }

  const zipPath = safePath([moduleId, 'module.zip']);
  let size = null;
  try {
    if (zipPath) {
      const stat = fs.statSync(zipPath);
      size = stat.size;
    }
  } catch { /* ok */ }

  jsonResponse(res, 200, {
    id: mf.id || moduleId,
    name: mf.name || moduleId,
    version: mf.version || '0.0.0',
    entry: mf.entry || 'main.js',
    minShellVersion: mf.minShellVersion || 1,
    permissions: mf.permissions || [],
    description: mf.description || '',
    metadata: mf.metadata || {},
    size,
  });
}

function handleModuleDownload(req, res, moduleId) {
  const mf = loadManifest(moduleId);
  if (!mf) {
    return errorResponse(res, 404, `Module not found: ${moduleId}`);
  }

  // Prefer pre-built zip; fall back to building on-the-fly
  const zipPath = safePath([moduleId, 'module.zip']);
  if (zipPath && fs.existsSync(zipPath)) {
    const stat = fs.statSync(zipPath);
    const filename = `${moduleId}-${mf.version || 'latest'}.zip`;
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Module-Id': moduleId,
      'X-Module-Version': mf.version || '0.0.0',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(zipPath).pipe(res);
    return;
  }

  errorResponse(res, 404, `Module zip not available for: ${moduleId}`);
}

function handleModuleVersion(req, res, moduleId) {
  const mf = loadManifest(moduleId);
  if (!mf) {
    return errorResponse(res, 404, `Module not found: ${moduleId}`);
  }

  jsonResponse(res, 200, {
    id: mf.id || moduleId,
    version: mf.version || '0.0.0',
    minShellVersion: mf.minShellVersion || 1,
    updated: mf.metadata?.updated || null,
    size: null, // filled below if available
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Telemetry
// ═══════════════════════════════════════════════════════════════════════════

const TELEMETRY_CACHE = []; // In-memory buffer: flush every 30s or 100 events
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH_SIZE = 100;

/**
 * Get today's telemetry log file path (YYYY-MM-DD.jsonl).
 */
function telemetryLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(TELEMETRY_DIR, `events-${date}.jsonl`);
}

/**
 * Get the device ping file — tracks unique devices per day.
 */
function pingLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(TELEMETRY_DIR, `pings-${date}.jsonl`);
}

/**
 * Write a single event to the JSONL buffer. Flushes when threshold reached.
 */
function writeTelemetryEvent(event) {
  const entry = {
    ...event,
    _received: new Date().toISOString(),
  };
  TELEMETRY_CACHE.push(entry);
  if (TELEMETRY_CACHE.length >= FLUSH_BATCH_SIZE) {
    flushTelemetry();
  }
}

/**
 * Flush buffered events to disk as JSONL (one JSON object per line).
 * Rotates file if it exceeds MAX_TELEMETRY_FILE_BYTES.
 */
function flushTelemetry() {
  if (TELEMETRY_CACHE.length === 0) return;
  const batch = TELEMETRY_CACHE.splice(0);
  try {
    const logPath = telemetryLogPath();
    // Rotate if too large
    try {
      const stat = fs.statSync(logPath);
      if (stat.size > MAX_TELEMETRY_FILE_BYTES) {
        const rotated = logPath.replace('.jsonl', `.${Date.now()}.jsonl`);
        fs.renameSync(logPath, rotated);
      }
    } catch { /* file doesn't exist yet, ok */ }

    const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(logPath, lines, 'utf-8');
  } catch (err) {
    console.error('[telemetry] flush error:', err.message);
  }
}

/**
 * Write a ping entry (device heartbeat).
 */
function writePing(deviceId, data) {
  try {
    const logPath = pingLogPath();
    const entry = JSON.stringify({
      deviceId,
      ts: Date.now(),
      ...data,
      _received: new Date().toISOString(),
    }) + '\n';
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (err) {
    console.error('[telemetry] ping error:', err.message);
  }
}

// Flush telemetry buffer periodically
setInterval(flushTelemetry, FLUSH_INTERVAL_MS);

/**
 * Validate and sanitise a telemetry event payload.
 */
function sanitiseEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const event = typeof body.event === 'string' ? body.event.slice(0, 128) : null;
  if (!event) return null;
  return {
    event,
    deviceId: typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : 'unknown',
    appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 32) : '',
    appBuild: typeof body.appBuild === 'string' ? body.appBuild.slice(0, 16) : '',
    payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    clientTs: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
  };
}

/**
 * GET /api/telemetry/ping — Device heartbeat (query params)
 */
function handlePing(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const deviceId = url.searchParams.get('device') || 'unknown';
  const appVer = url.searchParams.get('ver') || '';
  const appBuild = url.searchParams.get('build') || '';

  writePing(deviceId, {
    event: 'ping',
    appVersion: appVer,
    appBuild,
    ip: req.socket?.remoteAddress || '',
    ua: req.headers['user-agent'] || '',
  });

  res.writeHead(204);
  res.end();
}

/**
 * POST /api/telemetry/event — Single event
 */
function handleTelemetryEvent(req, res, body) {
  const event = sanitiseEvent(body);
  if (!event) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid event body — requires string event field' }));
    return;
  }
  writeTelemetryEvent(event);
  res.writeHead(202);
  res.end(JSON.stringify({ status: 'ok' }));
}

/**
 * POST /api/telemetry/batch — Batch of events
 */
function handleTelemetryBatch(req, res, body) {
  const events = Array.isArray(body) ? body : (body?.events || []);
  if (!Array.isArray(events) || events.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected array of events or {events: [...]}' }));
    return;
  }

  let accepted = 0;
  for (const raw of events) {
    const event = sanitiseEvent(raw);
    if (event) {
      writeTelemetryEvent(event);
      accepted++;
    }
  }

  res.writeHead(202);
  res.end(JSON.stringify({ status: 'ok', accepted }));
}

/**
 * GET /api/telemetry/summary — Quick aggregate stats
 */
function handleTelemetrySummary(req, res) {
  try {
    const entries = fs.readdirSync(TELEMETRY_DIR);
    const eventFiles = entries.filter(f => f.startsWith('events-') && f.endsWith('.jsonl'));
    const pingFiles = entries.filter(f => f.startsWith('pings-') && f.endsWith('.jsonl'));

    // Count lines in current files
    let eventCount = 0;
    let pingCount = 0;
    for (const f of eventFiles) {
      try {
        const content = fs.readFileSync(path.join(TELEMETRY_DIR, f), 'utf-8');
        eventCount += content.split('\n').filter(l => l.trim()).length;
      } catch {}
    }
    for (const f of pingFiles) {
      try {
        const content = fs.readFileSync(path.join(TELEMETRY_DIR, f), 'utf-8');
        pingCount += content.split('\n').filter(l => l.trim()).length;
      } catch {}
    }

    jsonResponse(res, 200, {
      status: 'ok',
      eventFiles: eventFiles.length,
      pingFiles: pingFiles.length,
      totalEvents: eventCount,
      totalPings: pingCount,
      bufferSize: TELEMETRY_CACHE.length,
      telemetryDir: TELEMETRY_DIR,
    });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/';

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  // ── Telemetry Routes (allow POST body) ──
  if (pathname === '/api/telemetry/ping' && req.method === 'GET') {
    handlePing(req, res);
    return;
  }

  if (pathname === '/api/telemetry/summary' && req.method === 'GET') {
    handleTelemetrySummary(req, res);
    return;
  }

  if ((pathname === '/api/telemetry/event' || pathname === '/api/telemetry/batch') && req.method === 'POST') {
    return readJsonBody(req, (body) => {
      if (pathname === '/api/telemetry/event') {
        handleTelemetryEvent(req, res, body);
      } else {
        handleTelemetryBatch(req, res, body);
      }
    });
  }

  // ── Route: GET /api/catalogue ──
  if (pathname === '/api/catalogue') {
    handleCatalogue(req, res);
    return;
  }

  // ── Route: GET /api/modules/:id/:action ──
  const moduleRoute = pathname.match(/^\/api\/modules\/([^/]+)\/([^/]+)$/);
  if (moduleRoute) {
    const [, moduleId, action] = moduleRoute;

    switch (action) {
      case 'download':
        handleModuleDownload(req, res, moduleId);
        return;
      case 'version.json':
        handleModuleVersion(req, res, moduleId);
        return;
      default:
        errorResponse(res, 404, `Unknown action: ${action}`);
        return;
    }
  }

  // ── Route: GET /api/modules/:id ──
  const detailRoute = pathname.match(/^\/api\/modules\/([^/]+)$/);
  if (detailRoute) {
    handleModuleDetail(req, res, detailRoute[1]);
    return;
  }

  // ── Route: GET /health ──
  if (pathname === '/health') {
    jsonResponse(res, 200, { status: 'ok', modules: listModules().length });
    return;
  }

  errorResponse(res, 404, 'Not Found');
});

/**
 * Read JSON body from a POST request and call callback with parsed body.
 */
function readJsonBody(req, cb) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    try {
      cb(JSON.parse(body));
    } catch {
      cb(null);
    }
  });
  req.on('error', () => cb(null));
}

server.listen(PORT, HOST, () => {
  console.log(`[marketplace] red-thread.ffilt.us serving ${MODULES_DIR} on http://${HOST}:${PORT}`);
});
