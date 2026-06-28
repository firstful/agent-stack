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
    'Cache-Control': 'public, max-age=3600',
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

  // ── GameVersion OTA Update Endpoint ──
  if (url.pathname === '/apk/update') {
    const appId = url.searchParams.get('app');
    const ver = url.searchParams.get('ver');
    if (!appId || !ver) {
      res.writeHead(400);
      res.end('Missing app or ver parameter');
      return;
    }
    try {
      const metaPath = path.join(FILES_DIR, 'apk', 'version.json');
      const metaRaw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (meta.app !== appId) {
        res.writeHead(400);
        res.end('Unknown app');
        return;
      }
      // Compare versions — simple string comparison works for semver-like v1.0.XX
      const currentParts = meta.version.split('.').map(Number);
      const installedParts = ver.split('.').map(Number);
      let needsUpdate = false;
      for (let i = 0; i < Math.max(currentParts.length, installedParts.length); i++) {
        const c = currentParts[i] || 0;
        const v = installedParts[i] || 0;
        if (c > v) { needsUpdate = true; break; }
        if (c < v) { break; }
      }
      if (!needsUpdate) {
        res.writeHead(202);
        res.end('Up to date');
        return;
      }
      const apkPath = path.join(FILES_DIR, 'apk', meta.apk);
      const apkStat = fs.statSync(apkPath);
      res.writeHead(200, {
        'X-Update-Version': meta.version,
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': apkStat.size,
        'Content-Disposition': `attachment; filename="${meta.apk}"`,
      });
      fs.createReadStream(apkPath).pipe(res);
      return;
    } catch (e) {
      res.writeHead(500);
      res.end('Update service error');
      return;
    }
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
