#!/usr/bin/env node
/**
 * install.ffilt.us — OTA update service for Android APKs
 *
 * A focused, minimal service that handles everything related to
 * APK delivery and OTA updates, split from the general file server.
 *
 * Endpoints:
 *   GET /update?app=<id>&ver=<current>
 *       — OTA update check. 202 = up to date, 200 = serves APK.
 *   GET /:filename
 *       — Serve versioned APK or version.json.
 *   GET /:app.apk
 *       — Redirect stable APK name → latest versioned file.
 *
 * The APK directory layout under FILES_DIR/apk/:
 *   version.json         — {app, version, apk: "red-thread-1.0.30.apk"}
 *   red-thread-1.0.30.apk — versioned APK files
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.env.PORT || '3651', 10);
const HOST = process.env.HOST || '0.0.0.0';
const FILES_DIR = path.resolve(process.env.FILES_DIR || '/srv/files');

const APK_DIR = path.join(FILES_DIR, 'apk');

const MIME_TYPES = {
  '.apk':  'application/vnd.android.package-archive',
  '.json': 'application/json',
};

// ── Version manifest ─────────────────────────────────────────────────────

function readVersionJson() {
  const vp = path.join(APK_DIR, 'version.json');
  try {
    return JSON.parse(fs.readFileSync(vp, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Route: OTA Update ────────────────────────────────────────────────────

function handleUpdate(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const app = url.searchParams.get('app');
  const ver = url.searchParams.get('ver');

  if (!app || !ver) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing app or ver parameter' }));
    return;
  }

  const vi = readVersionJson();
  if (!vi) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Version manifest not found' }));
    return;
  }

  if (vi.app !== app) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown app: ${app}` }));
    return;
  }

  if (ver === vi.version) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'current', version: vi.version, app: vi.app }));
    return;
  }

  const apkPath = path.join(APK_DIR, vi.apk);
  try {
    const stat = fs.statSync(apkPath);
    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${vi.apk}"`,
      'X-Update-Version': vi.version,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
    res.writeHead(200, headers);
    fs.createReadStream(apkPath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'APK file not found on server' }));
  }
}

// ── Route: Stable → versioned redirect ───────────────────────────────────

// Map of stable names → app identifiers for version.json lookup
const STABLE_APKS = ['red-thread.apk'];

function tryRedirectApk(res, filename) {
  if (!STABLE_APKS.includes(filename)) return false;
  const vi = readVersionJson();
  if (!vi || !vi.apk) return false;
  res.writeHead(302, {
    Location: `/${vi.apk}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end();
  return true;
}

// ── Route: Serve file ────────────────────────────────────────────────────

function serveFile(res, filePath, filename) {
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.apk' ? 'no-cache' : 'public, max-age=3600',
    };
    // Force download for APK files
    if (ext === '.apk') {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ── Request router ───────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/index';

  // ── Route: OTA update check ──
  if (pathname === '/update' || pathname === '/update/') {
    handleUpdate(req, res);
    return;
  }

  // ── Get the filename from the request path ──
  const filename = pathname.replace(/^\//, '');

  // ── Route: Stable APK → versioned redirect ──
  if (tryRedirectApk(res, filename)) {
    return;
  }

  // ── Route: Serve file from APK directory ──
  const safePath = path.resolve(path.join(APK_DIR, filename));
  if (!safePath.startsWith(APK_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(res, safePath, filename);
});

server.listen(PORT, HOST, () => {
  console.log(`[install] install.ffilt.us serving ${APK_DIR} on http://${HOST}:${PORT}`);
});
