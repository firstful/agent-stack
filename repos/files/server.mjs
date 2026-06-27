#!/usr/bin/env node
/**
 * file.ffilt.us — Simple file hosting service
 *
 * Serves files from FILES_DIR with proper Content-Type headers.
 * HTML files render in the browser (not download).
 * Supports directory listing for browsing.
 * Also provides an OTA update endpoint at /apk/update.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = parseInt(process.env.PORT || '3650', 10);
const FILES_DIR = path.resolve(process.env.FILES_DIR || '/srv/files');
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.htm':   'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
  '.pdf':   'application/pdf',
  '.mp4':   'video/mp4',
  '.webm':  'video/webm',
  '.mp3':   'audio/mpeg',
  '.ogg':   'audio/ogg',
  '.apk':   'application/vnd.android.package-archive',
  '.zip':   'application/zip',
  '.tar':   'application/x-tar',
  '.gz':    'application/gzip',
  '.md':    'text/markdown; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
  '.yaml':  'text/yaml; charset=utf-8',
  '.yml':   'text/yaml; charset=utf-8',
  '.toml':  'text/plain; charset=utf-8',
  '.xml':   'application/xml',
};

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  console.log(`[files] Created ${FILES_DIR}`);
}

// ── Update endpoint version tracking ──
const APK_DIR = path.join(FILES_DIR, 'apk');

function readVersionJson() {
  const vp = path.join(APK_DIR, 'version.json');
  try {
    return JSON.parse(fs.readFileSync(vp, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Serve the OTA update endpoint.
 * GET /apk/update?app=<package>&ver=<current-version>
 *
 * If the client's version matches the published version → 202 (up to date).
 * If the client is behind → 200 with the APK bytes.
 */
function handleUpdateEndpoint(req, res) {
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

  // Check if this app is known
  if (vi.app !== app) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown app: ${app}` }));
    return;
  }

  // Version check
  if (ver === vi.version) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'current', version: vi.version, app: vi.app }));
    return;
  }

  // Serve the APK
  const apkPath = path.join(APK_DIR, vi.apk);

  try {
    const stat = fs.statSync(apkPath);
    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${vi.apk}"`,
      'X-Update-Version': vi.version,
      'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(apkPath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'APK file not found on server' }));
  }
}

// ── Stable → versioned APK redirects ──
// Cloudflare caches by URL, so stable filenames like red-thread.apk
// serve stale content between releases. We redirect to the versioned
// filename (red-thread-1.0.27.apk) so each release gets a unique URL.

const APK_REDIRECTS = ['/red-thread.apk', '/apk/red-thread.apk'];

function tryRedirectApk(res, urlPath) {
  if (!APK_REDIRECTS.includes(urlPath)) return false;
  const vi = readVersionJson();
  if (!vi || !vi.apk) return false;
  // All versioned APKs live under /apk/ — redirect accordingly
  const target = `/apk/${vi.apk}`;
  res.writeHead(302, {
    Location: target,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end();
  return true;
}

// ── File serving ──

function serveFile(res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  // Force download for archive types, render everything else in browser
  const isDownload = ['.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.exe', '.dmg', '.pkg'].includes(ext);
  const headers = {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': ['.apk', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
  };

  if (isDownload) {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function serveDirectoryListing(res, dirPath, relPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => {
      const full = path.join(dirPath, e.name);
      let stat;
      try { stat = fs.statSync(full); } catch { return null; }
      const isDir = e.isDirectory();
      return {
        name: e.name + (isDir ? '/' : ''),
        isDir,
        size: isDir ? null : stat.size,
        mtime: stat.mtime,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Index of /${relPath}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a0f;color:#e2e2f0;max-width:800px;margin:0 auto;padding:20px}
  h1{font-size:1.2rem;font-weight:600;margin-bottom:20px;color:#8a8aaa}
  a{color:#6ee7b7;text-decoration:none}
  a:hover{text-decoration:underline}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;color:#8a8aaa;font-size:.8rem;text-transform:uppercase;padding:8px 12px;border-bottom:1px solid #2a2a3e}
  td{padding:8px 12px;border-bottom:1px solid #1a1a28;font-size:.9rem}
  td:last-child{text-align:right;color:#8a8aaa;font-variant-numeric:tabular-nums}
  tr:hover td{background:#12121a}
  .size{color:#8a8aaa}
  .dir{color:#3b82f6;font-weight:500}
</style></head>
<body>
<h1>📁 Index of /${relPath}</h1>
<table>
<tr><th>Name</th><th>Size</th></tr>
${relPath ? '<tr><td colspan="2"><a href="..">../</a></td></tr>' : ''}
${items.map(i => {
  const icon = i.isDir ? '📁' : '📄';
  const size = i.isDir ? '—' : formatSize(i.size);
  const cls = i.isDir ? 'dir' : '';
  return `<tr><td class="${cls}">${icon} <a href="${encodeURIComponent(i.name)}">${i.name}</a></td><td>${size}</td></tr>`;
}).join('\n')}
</table>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getSafePath(rawPath) {
  // Decode and normalize
  const decoded = decodeURIComponent(rawPath);
  const normalized = path.normalize(decoded).replace(/^\.\.(\/|\\)+/g, '');
  const fullPath = path.join(FILES_DIR, normalized);
  // Security: ensure resolved path is within FILES_DIR
  if (!fullPath.startsWith(FILES_DIR)) return null;
  return fullPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── Route: OTA Update endpoint ──
  if (url.pathname === '/apk/update' || url.pathname === '/apk/update/') {
    handleUpdateEndpoint(req, res);
    return;
  }

  // ── Route: Stable APK → versioned redirect ──
  if (tryRedirectApk(res, url.pathname)) {
    return;
  }

  // ── Default: file serving ──
  let filePath = getSafePath(url.pathname);

  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Check for index.html
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        const idxStat = fs.statSync(indexPath);
        serveFile(res, indexPath, idxStat);
      } else {
        serveDirectoryListing(res, filePath, url.pathname.replace(/^\//, ''));
      }
    } else if (stat.isFile()) {
      serveFile(res, filePath, stat);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[files] file.ffilt.us serving ${FILES_DIR} on http://${HOST}:${PORT}`);
});
