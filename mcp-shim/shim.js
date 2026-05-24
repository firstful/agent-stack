#!/usr/bin/env node
const http = require("http");
const net = require("net");
const readline = require("readline");


const MCP_PORT = process.env.MCP_PORT || 9000;
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || null;
const MCP_SOCKET_PATH = process.env.MCP_SOCKET_PATH || "/host/tmp/agent-stack.sock";

const CANDIDATES = [
  "localhost",
  "127.0.0.1",
  "host.containers.internal",
  "host.docker.internal",
];

function tcpCheck(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(timeout, () => {
      s.destroy();
      resolve(false);
    });
  });
}

function httpPost(endpoint, path, body, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const isUnix = endpoint.startsWith("unix://");
    const opts = isUnix
      ? {
          socketPath: endpoint.slice(7),
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        }
      : {
          hostname: endpoint.hostname,
          port: endpoint.port,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        };
    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("non-JSON response: " + raw.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(data);
    req.end();
  });
}

async function discover() {
  if (MCP_ENDPOINT) {
    console.error(`[mcp-shim] using MCP_ENDPOINT: ${MCP_ENDPOINT}`);
    return { endpoint: MCP_ENDPOINT, isUnix: MCP_ENDPOINT.startsWith("unix://") };
  }
  const fs = require("fs");
  if (fs.existsSync(MCP_SOCKET_PATH)) {
    const base = `unix://${MCP_SOCKET_PATH}`;
    console.error(`[mcp-shim] discovered Unix socket at ${MCP_SOCKET_PATH}`);
    return { endpoint: base, isUnix: true };
  }
  for (const host of CANDIDATES) {
    const ok = await tcpCheck(host, MCP_PORT);
    if (ok) {
      const base = `http://${host}:${MCP_PORT}`;
      console.error(`[mcp-shim] discovered endpoint at ${base}`);
      return { endpoint: base, isUnix: false };
    }
    console.error(`[mcp-shim] no response from ${host}:${MCP_PORT}`);
  }
  throw new Error(
    "Could not discover MCP endpoint — tried Unix socket + " + CANDIDATES.join(", ")
  );
}

const TOOLS = [
  { name: "list_services", description: "List all services", inputSchema: { type: "object", properties: {} } },
  { name: "get_service_status", description: "Get status of a service", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "create_service", description: "Create a service", inputSchema: { type: "object", properties: { name: { type: "string" }, repo: { type: "string" }, port: { type: "number" }, env: { type: "object" }, volumes: { type: "array", items: { type: "string" } }, expose_enabled: { type: "boolean" }, hostname: { type: "string" }, tunnel: { type: "string" } }, required: ["name", "repo"] } },
  { name: "update_service", description: "Update a service", inputSchema: { type: "object", properties: { name: { type: "string" }, port: { type: "number" }, env: { type: "object" }, volumes: { type: "array", items: { type: "string" } }, expose_enabled: { type: "boolean" }, hostname: { type: "string" }, tunnel: { type: "string" } }, required: ["name"] } },
  { name: "delete_service", description: "Delete a service", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_service_logs", description: "Get service logs", inputSchema: { type: "object", properties: { name: { type: "string" }, lines: { type: "number" } }, required: ["name"] } },
  { name: "start_service", description: "Start a service", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "stop_service", description: "Stop a service", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "restart_service", description: "Restart a service", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "rebuild_service", description: "Rebuild a service container from latest source", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "reconcile", description: "Trigger reconciliation", inputSchema: { type: "object", properties: {} } },
];

const CAPABILITIES = {
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "mcp-stdio-shim", version: "1.0.0" },
};

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRequest(ep, msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return jsonRpcResult(id, CAPABILITIES);
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (!name) {
      return jsonRpcError(id, -32602, "Missing tool name");
    }
    const path = `/mcp/${name}`;
    try {
      const result = await httpPost(ep.endpoint, path, args);
      if (result.error) {
        return jsonRpcError(id, -32603, result.error);
      }
      return jsonRpcResult(id, result);
    } catch (e) {
      return jsonRpcError(id, -32603, e.message);
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

async function main() {
  const ep = await discover();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      console.error("[mcp-shim] invalid JSON:", trimmed.slice(0, 200));
      continue;
    }

    try {
      const response = await handleRequest(ep, msg);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (e) {
      const resp = jsonRpcError(
        msg && msg.id != null ? msg.id : null,
        -32603,
        e.message
      );
      process.stdout.write(JSON.stringify(resp) + "\n");
    }
  }
}

main().catch((e) => {
  console.error("[mcp-shim] fatal:", e.message);
  process.exit(1);
});
