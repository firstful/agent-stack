import http from "http";
import fs from "fs";

const RUNTIME_FILE = "/runtime/services.json";
const PROXY_PORT = parseInt(process.env.PORT || "80", 10);
const CTRL_HOST = process.env.CTRL_HOST || "host.containers.internal";
const CTRL_PORT = process.env.CTRL_PORT || "80";
const CTRL_BASE = `http://${CTRL_HOST}:${CTRL_PORT}`;
const DASH_HOSTNAME = process.env.DASH_HOSTNAME || "dash.ffilt.us";

// ── State ──────────────────────────────────────────────────

let state = {};

function loadState() {
  try {
    state = JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf-8"));
  } catch {
    state = {};
  }
}

loadState();

try {
  fs.watch(RUNTIME_FILE, (event) => {
    if (event === "change") loadState();
  });
} catch {
  try {
    fs.watch("/runtime", (event, filename) => {
      if (filename === "services.json") loadState();
    });
  } catch {}
}

// ── Routing ────────────────────────────────────────────────

function resolveTarget(url, hostname) {
  const pathMatch = url.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (pathMatch) {
    const svc = state[pathMatch[1]];
    if (svc && svc.port) {
      return { name: pathMatch[1], port: svc.port, path: pathMatch[2] || "/" };
    }
  }

  if (hostname) {
    for (const [name, svc] of Object.entries(state)) {
      if (svc.exposed === hostname && svc.port && !svc.expose?.no_proxy) {
        return { name, port: svc.port, path: url };
      }
    }
    for (const [name, svc] of Object.entries(state)) {
      if (svc.exposed && svc.exposed.startsWith("*.") && svc.port && !svc.expose?.no_proxy) {
        const suffix = svc.exposed.slice(1);
        if (hostname.endsWith(suffix)) {
          return { name, port: svc.port, path: url };
        }
      }
    }
  }

  return null;
}

// ── Reverse proxy ──────────────────────────────────────────

function proxyTo(url, port, host, req, res) {
  const opts = {
    hostname: host,
    port,
    path: url,
    method: req.method,
    headers: { ...req.headers },
  };

  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Proxy error: ${e.message}` }));
  });

  req.pipe(proxyReq);
}

// ── Controller helpers (for Dash UI) ───────────────────────

const STATUS_COLORS = { healthy: "#22c55e", degraded: "#eab308", down: "#ef4444" };
const LOGO_COLORS = {
  opencode: "#8b5cf6",
  "kilocode-web": "#3b82f6",
  dash: "#22c55e",
  appflowy: "#14b8a6",
  cockpit: "#f97316",
  "free-llm-router": "#a855f7",
  "marp-editor": "#ec4899",
  "no-service": "#64748b",
  openchamber: "#06b6d4",
  "personal-blog": "#eab308",
  techdeck: "#0ea5e9",
};

const LOGO_ICONS = {
  opencode: '<path d="M10 22l6-6-6-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 22h4" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>',
  "kilocode-web": '<path d="M12 10l4 2-4 2" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 10l4 2-4 2" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  dash: '<rect x="5" y="5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="18" y="5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="5" y="18" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/><rect x="18" y="18" width="9" height="9" rx="1.5" stroke="white" stroke-width="1.8" fill="none"/>',
  appflowy: '<path d="M10 24V8l12 16V8" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  cockpit: '<circle cx="16" cy="16" r="10" stroke="white" stroke-width="1.8" fill="none"/><path d="M8 16h16" stroke="white" stroke-width="1.8"/><path d="M16 8v16" stroke="white" stroke-width="1.8"/><circle cx="16" cy="16" r="3" fill="white"/>',
  "free-llm-router": '<circle cx="16" cy="8" r="2.5" fill="white"/><circle cx="8" cy="22" r="2.5" fill="white"/><circle cx="24" cy="22" r="2.5" fill="white"/><path d="M16 10.5l-6 9" stroke="white" stroke-width="1.5"/><path d="M16 10.5l6 9" stroke="white" stroke-width="1.5"/>',
  "marp-editor": '<rect x="5" y="6" width="22" height="18" rx="2" stroke="white" stroke-width="1.8" fill="none"/><path d="M5 14h22" stroke="white" stroke-width="1.8"/><circle cx="9" cy="10" r="1" fill="white"/><circle cx="13" cy="10" r="1" fill="white"/><circle cx="17" cy="10" r="1" fill="white"/>',
  "no-service": '<circle cx="16" cy="16" r="9" stroke="white" stroke-width="1.8" fill="none"/><path d="M8 8l16 16" stroke="white" stroke-width="1.8"/>',
  openchamber: '<path d="M6 10c0-2.2 1.8-4 4-4h12c2.2 0 4 1.8 4 4v6c0 2.2-1.8 4-4 4h-4l-5 4v-4h-3c-2.2 0-4-1.8-4-4z" stroke="white" stroke-width="1.8" fill="none"/>',
  "personal-blog": '<path d="M8 22V6l8 5 8-5v16" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  techdeck: '<path d="M6 10h20" stroke="white" stroke-width="2.2" stroke-linecap="round"/><path d="M6 16h14" stroke="white" stroke-width="2.2" stroke-linecap="round"/><path d="M6 22h8" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
};

function getLogoSvg(name) {
  const color = LOGO_COLORS[name] || "#334155";
  const icon = LOGO_ICONS[name];
  if (icon) {
    return `<svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>${icon}</svg>`;
  }
  return `<svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="monospace" font-size="11" font-weight="bold">&lt;/&gt;</text></svg>`;
}

function ctrlGet(pathname, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${CTRL_BASE}${pathname}`, { timeout }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("non-JSON: " + raw.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function ctrlPost(name, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ method: "tools/call", params: { name, arguments: args } });
    const req = http.request(`${CTRL_BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("non-JSON: " + raw.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function mcpParse(response) {
  if (!response || !response.content || !Array.isArray(response.content) || !response.content[0]) return null;
  const text = response.content[0].text;
  try { return JSON.parse(text); }
  catch { return text; }
}

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30_000;

async function getStatuses(serviceNames) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;

  let health = null;
  const statusMap = {};

  try {
    const data = await ctrlGet("/status", 10_000);
    health = {
      healthy: data.healthy,
      uptime: data.uptime,
      startTime: data.startTime,
      lastReconcile: data.lastReconcile,
      reconcileCount: data.reconcileCount,
      errors: [
        ...(data.reconcileErrors || []),
        ...(data.buildErrors || []),
        ...(data.toolErrors || []),
      ],
      cloudflaredError: data.cloudflaredError,
    };

    const services = data.services || {};
    const runningServices = [];

    for (const name of serviceNames) {
      const svc = services[name];
      if (!svc || !svc.running) {
        statusMap[name] = "down";
      } else {
        statusMap[name] = "healthy";
        runningServices.push(name);
      }
    }

    await Promise.all(runningServices.map(async (name) => {
      try {
        const result = await ctrlPost("get_service_logs", { name, lines: 100 }, 4_000);
        const logs = mcpParse(result);
        if (logs && typeof logs === "string" && /error|warning|warn|fail|exception|stacktrace/i.test(logs)) {
          statusMap[name] = "degraded";
        }
      } catch {}
    }));
  } catch {
    try {
      const result = await ctrlPost("list_services", {}, 8_000);
      const list = mcpParse(result);
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (!entry.name || !serviceNames.includes(entry.name)) continue;
          statusMap[entry.name] = entry.running ? "healthy" : "down";
        }
      }
    } catch {
      for (const name of serviceNames) statusMap[name] = "down";
    }
  }

  cache = { statusMap, health };
  cacheTime = now;
  return cache;
}

async function readServices() {
  try {
    const data = await ctrlGet("/status", 10_000);
    const raw = data.services || {};
    return Object.values(raw).filter(s => s && s.name);
  } catch {
    return [];
  }
}

// ── Dash UI rendering ──────────────────────────────────────

function renderCard(svc, status) {
  const name = svc.name || "unknown";
  const port = svc.container?.port || svc.service?.port || null;
  const hostname = svc.expose?.hostname || null;
  const url = hostname ? `https://${hostname}` : null;
  const color = STATUS_COLORS[status] || "#94a3b8";
  const hostLabel = hostname && hostname !== "*" ? hostname : null;
  const logo = getLogoSvg(name);
  return `<div class="card">
    <div class="card-header">
      ${logo}
      <div class="card-title-row">
        <h2>${name}</h2>
        <span class="status-dot" style="background:${color}"></span>
      </div>
    </div>
    <div class="card-body">
      ${port ? `<div class="info"><span class="label">Port</span><span class="value">${port}</span></div>` : ""}
      ${hostLabel ? `<div class="info"><span class="label">URL</span><a href="${url}" target="_blank">${hostLabel}</a></div>` : ""}
      ${svc.repo ? `<div class="info"><span class="label">Repo</span><span class="value mono">${svc.repo}</span></div>` : ""}
    </div>
    <div class="card-footer">
      <span class="status-label ${status}">${status}</span>
    </div>
  </div>`;
}

function renderHealthBanner(health) {
  if (!health) return "";
  const errorCount = health.errors ? health.errors.length : 0;
  const cfError = health.cloudflaredError;
  const healthy = health.healthy && errorCount === 0 && !cfError;
  const bg = healthy ? "#064e3b" : "#7f1d1d";
  const border = healthy ? "#22c55e" : "#ef4444";
  const text = healthy ? "#a7f3d0" : "#fecaca";
  const ico = healthy ? "&#10003;" : "&#9888;";
  let details = `<span class="health-label">Controller ${healthy ? "healthy" : "unhealthy"}</span>`;
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

function renderHTML(services, statusMap, health, unknownHost) {
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
    ${unknownHost ? `<div style="background:#1e1b4b;border:1px solid #6366f1;color:#c7d2fe;padding:0.75rem 1rem;border-radius:8px;margin-bottom:1.5rem;font-size:0.9rem;display:flex;align-items:center;gap:0.5rem">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      <span><strong>${unknownHost}</strong> is not a configured service</span>
    </div>` : ""}
    ${banner}
    ${services.length === 0
      ? `<div class="empty"><h2>No services found</h2><p>Check controller connection at <code>${CTRL_BASE}</code></p></div>`
      : `<div class="grid">${cards}</div>`
    }
    <footer>dash.ffilt.us</footer>
  </div>
</body>
</html>`;
}

// ── HTTP handler ───────────────────────────────────────────

function handleRequest(req, res) {
  const hostname = req.headers["host"] || "";

  // Probe controller health
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Dash hostname serves the UI directly
  if (hostname === DASH_HOSTNAME) {
    handleDashUI(req, res, null);
    return;
  }

  // Route known services
  const target = resolveTarget(req.url || "/", hostname);
  if (target) {
    proxyTo(target.path, target.port, "host.containers.internal", req, res);
    return;
  }

  // Serve Dash UI directly
  const unknownHost = hostname && hostname !== DASH_HOSTNAME ? hostname : null;
  handleDashUI(req, res, unknownHost);
}

async function handleDashUI(req, res, unknownHost) {
  try {
    const services = await readServices();
    const names = services.map((s) => s.name).filter(Boolean);

    const { statusMap, health } = await getStatuses(names);

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

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderHTML(services, statusMap, health, unknownHost));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end(`<html><body><h1>Dash unavailable</h1><p>${e.message}</p></body></html>`);
  }
}

function handleUpgrade(req, socket, head) {
  const hostname = req.headers["host"] || "";
  const target = resolveTarget(req.url || "/", hostname);
  if (!target) {
    socket.destroy();
    return;
  }

  const opts = {
    hostname: "host.containers.internal",
    port: target.port,
    path: target.path,
    method: "GET",
    headers: req.headers,
  };

  const proxyReq = http.request(opts);
  proxyReq.on("upgrade", (proxyRes, proxySocket) => {
    proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on("error", () => socket.destroy());
  proxyReq.end();
}

// ── Server ────────────────────────────────────────────────

const server = http.createServer(handleRequest);
server.on("upgrade", handleUpgrade);
server.listen(PROXY_PORT, () => {
  process.stdout.write(`[slot-proxy] listening on :${PROXY_PORT}\n`);
});
