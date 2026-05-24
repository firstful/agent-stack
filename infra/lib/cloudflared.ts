import fs from "fs";
import path from "path";
import { sh } from "./podman";
import type { Service } from "./types";
import { CLOUDFLARED_CONFIG, RESTART_COOLDOWN, RUNTIME_FILE } from "./config";

let lastRestart = 0;

function fmtHostname(h: string): string {
  return /[*?\[\]{}!|&]/.test(h) ? `"${h}"` : h;
}

function readRuntime(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function getProxyPort(runtime: Record<string, any>): number | null {
  return runtime["slot-proxy"]?.port || null;
}

function getActualPort(svc: Record<string, any>): number | null {
  if (svc.slots && svc.activeSlot && svc.slots[svc.activeSlot]?.port) {
    return svc.slots[svc.activeSlot].port;
  }
  return svc.port || null;
}

export function writeCloudflaredConfig(services: Service[]): void {
  const enabled = services.filter((s) => s.expose?.enabled);
  if (enabled.length === 0) return;

  const runtime = readRuntime();
  const proxyPort = getProxyPort(runtime);

  const tunnel = enabled[0].expose!.tunnel || "agent";

  let yaml: string;
  if (proxyPort) {
    // All services route through slot-proxy by Host header
    const wildcard = enabled.find((s) => s.expose?.no_proxy)?.expose?.hostname || "*.ffilt.us";
    yaml = `tunnel: ${tunnel}
ingress:
  - hostname: ${fmtHostname(wildcard)}
    service: http://127.0.0.1:${proxyPort}
  - service: http_status:404
`;
  } else {
    // No proxy — generate per-service ingress rules
    const ingressLines = enabled
      .filter((s) => s.expose!.hostname)
      .map((s) => {
        const port =
          getActualPort(runtime[s.name] || {}) ||
          (s.container && (s.container.host_port || s.container.port)) ||
          s.service?.port;
        return { hostname: s.expose!.hostname!, service: `http://127.0.0.1:${port}` };
      });
    yaml = `tunnel: ${tunnel}
ingress:
${[...ingressLines, { service: "http_status:404" }]
  .map((i) =>
    "hostname" in i
      ? `  - hostname: ${fmtHostname(i.hostname!)}\n    service: ${i.service}`
      : `  - service: ${i.service}`
  )
  .join("\n")}
`;
  }

  const cfgDir = path.dirname(CLOUDFLARED_CONFIG);
  if (!fs.existsSync(cfgDir)) {
    fs.mkdirSync(cfgDir, { recursive: true });
  }

  const prev = fs.existsSync(CLOUDFLARED_CONFIG)
    ? fs.readFileSync(CLOUDFLARED_CONFIG, "utf-8")
    : "";
  if (prev !== yaml) {
    fs.writeFileSync(CLOUDFLARED_CONFIG, yaml);
    const now = Date.now();
    if (now - lastRestart > RESTART_COOLDOWN) {
      lastRestart = now;
      console.log("[cloudflared] config changed, restarting tunnel");
      try {
        sh("sudo -n systemctl restart cloudflared");
      } catch (e: any) {
        console.error("[cloudflared] restart failed:", e.message);
      }
    } else {
      const remaining = Math.round(
        (RESTART_COOLDOWN - (now - lastRestart)) / 1000
      );
      console.log(
        `[cloudflared] config changed (cooldown ${remaining}s), deferred`
      );
    }
  }
}
