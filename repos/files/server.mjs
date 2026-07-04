#!/usr/bin/env node
/**
 * file.ffilt.us — Simple file hosting service with preview pages
 *
 * Serves files from FILES_DIR with proper Content-Type headers.
 * Direct URLs (no query params) serve raw files — curl/wget compatible.
 * Directory listing links to preview pages for files.
 * JS-powered downloads on preview pages for browser reliability.
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

// ── Previewable types ──
const TEXT_TYPES = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.css', '.js', '.log']);
const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const VIDEO_TYPES = new Set(['.mp4', '.webm']);
const AUDIO_TYPES = new Set(['.mp3', '.ogg']);

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  console.log('[files] Created ' + FILES_DIR);
}

// ── File serving ──

function serveFile(res, filePath, stat, forceDownload) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };
  if (forceDownload) {
    headers['Content-Disposition'] = 'attachment; filename="' + path.basename(filePath) + '"';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

// ── Preview page ──

function servePreviewPage(res, filePath, stat, relPath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const isImage = IMAGE_TYPES.has(ext);
  const isVideo = VIDEO_TYPES.has(ext);
  const isAudio = AUDIO_TYPES.has(ext);
  const isApk = ext === '.apk';
  const isPdf = ext === '.pdf';
  const sizeStr = formatSize(stat.size);
  const mtime = stat.mtime.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const fileUrl = relPath;

  // Text preview
  let textPreview = '';
  if (TEXT_TYPES.has(ext) && stat.size < 51200) {
    try { textPreview = escapeHtml(fs.readFileSync(filePath, 'utf-8').slice(0, 5000)); } catch {}
  }

  // Build preview HTML section
  let previewHtml = '';
  if (isImage) {
    previewHtml = '<div class="preview"><img src="/' + fileUrl + '" alt="' + escapeHtml(fileName) + '" loading="lazy"></div>';
  } else if (isVideo) {
    previewHtml = '<div class="preview"><video src="/' + fileUrl + '" controls preload="metadata"></video></div>';
  } else if (isAudio) {
    previewHtml = '<div class="preview"><audio src="/' + fileUrl + '" controls preload="metadata"></audio></div>';
  } else if (isPdf) {
    previewHtml = '<div class="preview"><embed class="pdf-embed" src="/' + fileUrl + '" type="application/pdf"></div>';
  } else if (textPreview) {
    previewHtml = '<div class="preview"><pre>' + textPreview + '</pre></div>';
  }

  const dlUrl = '/' + fileUrl;
  const jsFileName = JSON.stringify(fileName);
  const escapedFileName = escapeHtml(fileName);
  const escapedRelPath = escapeHtml(relPath);

  const html = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>' + escapedFileName + ' \u2014 file.ffilt.us</title>' +
'<style>' +
  '*,*::before,*::after{box-sizing:border-box}' +
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0f;color:#e2e2f0;max-width:720px;margin:0 auto;padding:20px;min-height:100vh}' +
  '.breadcrumb{font-size:.8rem;color:#6b7280;margin-bottom:16px}' +
  '.breadcrumb a{color:#6ee7b7;text-decoration:none}' +
  '.breadcrumb a:hover{text-decoration:underline}' +
  '.file-header{display:flex;align-items:flex-start;gap:16px;margin-bottom:24px}' +
  '.file-icon{font-size:2.5rem;line-height:1;flex-shrink:0;width:48px;text-align:center}' +
  '.file-meta{flex:1;min-width:0}' +
  '.file-name{font-size:1.1rem;font-weight:600;margin:0 0 4px;word-break:break-all;color:#f0f0ff}' +
  '.file-details{font-size:.85rem;color:#8a8aaa;display:flex;flex-wrap:wrap;gap:4px 16px}' +
  '.file-details span{white-space:nowrap}' +
  '.preview{margin-bottom:24px;border-radius:12px;overflow:hidden;background:#12121a}' +
  '.preview img{max-width:100%;max-height:60vh;display:block;margin:0 auto}' +
  '.preview video{max-width:100%;max-height:60vh;display:block;margin:0 auto}' +
  '.preview audio{width:100%;padding:20px}' +
  '.preview pre{overflow-x:auto;padding:16px;font-size:.8rem;line-height:1.4;color:#d4d4e8;margin:0;max-height:400px}' +
  '.preview .pdf-embed{width:100%;height:60vh;border:none}' +
  '.download-card{background:linear-gradient(135deg,#1e1e2e,#16162a);border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #2a2a3e}' +
  '.download-card h3{margin:0 0 12px;font-size:.9rem;color:#8a8aaa;text-transform:uppercase;letter-spacing:.05em}' +
  '.btn-group{display:flex;flex-wrap:wrap;gap:10px}' +
  '.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:8px;font-size:.95rem;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all .15s}' +
  '.btn-primary{background:#6ee7b7;color:#0a0a0f}' +
  '.btn-primary:hover{background:#5cd6a6;transform:translateY(-1px)}' +
  '.btn-secondary{background:#2a2a3e;color:#e2e2f0}' +
  '.btn-secondary:hover{background:#3a3a4e}' +
  '.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}' +
  '.btn .spinner{display:none;width:16px;height:16px;border:2px solid rgba(0,0,0,.2);border-top-color:#0a0a0f;border-radius:50%;animation:spin .6s linear}' +
  '.btn.loading .spinner{display:inline-block}' +
  '.btn.loading .btn-text{opacity:.7}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '.meta-table{width:100%;border-collapse:collapse;margin-top:12px;font-size:.85rem}' +
  '.meta-table td{padding:6px 0;border-bottom:1px solid #1a1a28}' +
  '.meta-table td:first-child{color:#8a8aaa;width:100px}' +
  '.meta-table td:last-child{color:#d4d4e8}' +
  '.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e2e;color:#e2e2f0;padding:12px 24px;border-radius:8px;font-size:.85rem;z-index:100;opacity:0;transition:opacity .3s;pointer-events:none;border:1px solid #2a2a3e}' +
  '.toast.show{opacity:1}' +
  '.toast.error{background:#3e1a1a;border-color:#6e2a2a;color:#ffb0b0}' +
'</style></head><body>' +

'<div class="breadcrumb"><a href="' + getParentDir(relPath) + '">\u2b05 Back</a></div>' +

'<div class="file-header">' +
  '<div class="file-icon">' + getFileIcon(ext, fileName) + '</div>' +
  '<div class="file-meta">' +
    '<h1 class="file-name">' + escapedFileName + '</h1>' +
    '<div class="file-details">' +
      '<span>' + sizeStr + '</span>' +
      '<span>' + mtime + '</span>' +
      '<span>' + mime + '</span>' +
    '</div>' +
  '</div>' +
'</div>' +

// Download card
'<div class="download-card">' +
  '<h3>' + (isApk ? '\ud83d\udcf1 Install' : '\u2b07 Download') + '</h3>' +
  '<div class="btn-group">' +
    '<button class="btn btn-primary" onclick="jsDownload()" id="dlBtn">' +
      '<span class="spinner"></span><span class="btn-text">' + (isApk ? 'Download & Install' : 'Download (' + sizeStr + ')') + '</span>' +
    '</button>' +
    '<a href="' + dlUrl + '" class="btn btn-secondary">Direct Link</a>' +
  '</div>' +
'</div>' +

// Preview
previewHtml +

// File info
'<div class="download-card">' +
  '<h3>\u2139 File Info</h3>' +
  '<table class="meta-table">' +
    '<tr><td>Filename</td><td>' + escapedFileName + '</td></tr>' +
    '<tr><td>Size</td><td>' + sizeStr + ' (' + stat.size + ' bytes)</td></tr>' +
    '<tr><td>Type</td><td>' + mime + '</td></tr>' +
    '<tr><td>Modified</td><td>' + mtime + '</td></tr>' +
    '<tr><td>Path</td><td style="font-family:monospace;font-size:.8rem">/' + escapedRelPath + '</td></tr>' +
    '<tr><td>curl</td><td style="font-family:monospace;font-size:.8rem">curl -OL https://files.ffilt.us/' + escapedRelPath + '</td></tr>' +
  '</table>' +
'</div>' +

'<div class="toast" id="toast"></div>' +

'<script>' +
'async function jsDownload(){' +
  'var btn=document.getElementById("dlBtn");' +
  'if(btn.classList.contains("loading"))return;' +
  'btn.classList.add("loading");' +
  'btn.disabled=true;' +
  'try{' +
    'var resp=await fetch(' + JSON.stringify(dlUrl) + ',{cache:"no-cache"});' +
    'if(!resp.ok)throw new Error("HTTP "+resp.status);' +
    'var blob=await resp.blob();' +
    'var url=URL.createObjectURL(blob);' +
    'var a=document.createElement("a");' +
    'a.href=url;' +
    'a.download=' + jsFileName + ';' +
    'document.body.appendChild(a);' +
    'a.click();' +
    'document.body.removeChild(a);' +
    'setTimeout(function(){URL.revokeObjectURL(url)},10000);' +
    'showToast("Download started");' +
  '}catch(e){' +
    'var a=document.createElement("a");' +
    'a.href=' + JSON.stringify(dlUrl) + ';' +
    'a.download=' + jsFileName + ';' +
    'document.body.appendChild(a);' +
    'a.click();' +
    'document.body.removeChild(a);' +
    'showToast("Download started (fallback)",true);' +
  '}finally{' +
    'btn.classList.remove("loading");' +
    'btn.disabled=false;' +
  '}' +
'}' +
'function showToast(msg,isError){' +
  'var t=document.getElementById("toast");' +
  't.textContent=msg;' +
  't.className="toast show"+(isError?" error":"");' +
  'setTimeout(function(){t.classList.remove("show")},4000);' +
'}' +
'</script>' +

'</body></html>';

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Directory listing ──

function serveDirectoryListing(res, dirPath, relPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = entries
    .filter(function(e) { return !e.name.startsWith('.'); })
    .map(function(e) {
      const full = path.join(dirPath, e.name);
      let stat;
      try { stat = fs.statSync(full); } catch { return null; }
      const isDir = e.isDirectory();
      return { name: e.name, displayName: e.name + (isDir ? '/' : ''), isDir: isDir, size: isDir ? null : stat.size, mtime: stat.mtime };
    })
    .filter(Boolean)
    .sort(function(a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  let rows = '';
  if (relPath) {
    rows += '<a href=".." class="item"><span class="item-icon">\ud83d\udcc1</span><span class="item-info"><span class="item-name">../</span></span></a>';
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const icon = item.isDir ? '\ud83d\udcc1' : getFileIcon(path.extname(item.name), item.name);
    const size = item.isDir ? '' : formatSize(item.size);
    const href = item.isDir ? encodeURIComponent(item.name) + '/' : '/' + (relPath ? relPath + '/' : '') + encodeURIComponent(item.name) + '?preview';
    const date = item.mtime ? item.mtime.toISOString().slice(0, 10) : '';
    rows += '<a href="' + href + '" class="item">' +
      '<span class="item-icon">' + icon + '</span>' +
      '<span class="item-info"><span class="item-name">' + item.displayName + '</span><span class="item-meta">' + date + '</span></span>' +
      '<span class="item-size">' + size + '</span></a>';
  }

  const html = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>Index of /' + (relPath || '') + '</title>' +
'<style>' +
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0f;color:#e2e2f0;max-width:800px;margin:0 auto;padding:20px}' +
  'h1{font-size:1.1rem;font-weight:600;margin-bottom:4px;color:#e2e2f0}' +
  '.subtitle{font-size:.85rem;color:#6b7280;margin-bottom:20px}' +
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}' +
  '.item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;text-decoration:none;color:#e2e2f0;transition:background .15s}' +
  '.item:hover{background:#12121a}' +
  '.item-icon{font-size:1.2rem;flex-shrink:0;width:24px;text-align:center}' +
  '.item-info{flex:1;min-width:0}' +
  '.item-name{font-size:.9rem;word-break:break-all;color:#e2e2f0}' +
  '.item-meta{font-size:.75rem;color:#6b7280}' +
  '.item-size{font-size:.75rem;color:#6b7280;flex-shrink:0;font-variant-numeric:tabular-nums}' +
'</style></head><body>' +
'<h1>\ud83d\udcc1 ' + (relPath || 'files.ffilt.us') + '</h1>' +
'<p class="subtitle">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</p>' +
'<div class="grid">' + rows + '</div>' +
'</body></html>';

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Helpers ──

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getFileIcon(ext, name) {
  if (IMAGE_TYPES.has(ext)) return '\ud83d\uddbc';
  if (VIDEO_TYPES.has(ext)) return '\ud83c\udfac';
  if (AUDIO_TYPES.has(ext)) return '\ud83c\udfb5';
  if (ext === '.pdf') return '\ud83d\udcc4';
  if (ext === '.apk') return '\ud83d\udcf1';
  if (ext === '.zip' || ext === '.tar' || ext === '.gz') return '\ud83d\udce6';
  return '\ud83d\udcc4';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getParentDir(relPath) {
  const parts = relPath.split('/');
  parts.pop();
  return parts.length ? '/' + parts.join('/') + '/' : '/';
}

function getSafePath(rawPath) {
  const decoded = decodeURIComponent(rawPath);
  const normalized = path.normalize(decoded).replace(/^\.\.(\/|\\)+/g, '');
  const fullPath = path.join(FILES_DIR, normalized);
  if (!fullPath.startsWith(FILES_DIR)) return null;
  return fullPath;
}

// ── Server ──

const server = http.createServer(function(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  // ── OTA Update ──
  if (url.pathname === '/apk/update') {
    const appId = url.searchParams.get('app');
    const ver = url.searchParams.get('ver');
    if (!appId || !ver) { res.writeHead(400); res.end('Missing app or ver parameter'); return; }
    try {
      const metaPath = path.join(FILES_DIR, 'apk', 'version.json');
      const metaRaw = fs.readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (meta.app !== appId) { res.writeHead(400); res.end('Unknown app'); return; }
      const currentParts = meta.version.split('.').map(Number);
      const installedParts = ver.split('.').map(Number);
      let needsUpdate = false;
      for (let i = 0; i < Math.max(currentParts.length, installedParts.length); i++) {
        const c = currentParts[i] || 0;
        const v = installedParts[i] || 0;
        if (c > v) { needsUpdate = true; break; }
        if (c < v) { break; }
      }
      if (!needsUpdate) { res.writeHead(202); res.end('Up to date'); return; }
      const apkPath = path.join(FILES_DIR, 'apk', meta.apk);
      const apkStat = fs.statSync(apkPath);
      res.writeHead(200, {
        'X-Update-Version': meta.version,
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': apkStat.size,
        'Content-Disposition': 'attachment; filename="' + meta.apk + '"',
      });
      fs.createReadStream(apkPath).pipe(res);
      return;
    } catch (e) { res.writeHead(500); res.end('Update service error'); return; }
  }

  // ── File serving ──
  let filePath = getSafePath(url.pathname);
  if (!filePath) { res.writeHead(403); res.end('Forbidden'); return; }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const p = url.pathname;
      if (!p.endsWith('/')) { res.writeHead(301, { 'Location': p + '/' }); res.end(); return; }
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        serveFile(res, indexPath, fs.statSync(indexPath));
      } else {
        serveDirectoryListing(res, filePath, url.pathname.replace(/^\//, ''));
      }
    } else if (stat.isFile()) {
      if (url.searchParams.has('preview')) {
        servePreviewPage(res, filePath, stat, url.pathname.replace(/^\//, ''));
      } else {
        serveFile(res, filePath, stat);
      }
    } else {
      res.writeHead(404); res.end('Not Found');
    }
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
});

server.listen(PORT, HOST, function() {
  console.log('[files] file.ffilt.us serving ' + FILES_DIR + ' on http://' + HOST + ':' + PORT);
});
