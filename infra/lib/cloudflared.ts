/**
 * cloudflared.ts — Cloudflare Tunnel config generation for the agent-stack controller.
 *
 * Generates /etc/cloudflared/config.yml from the desired service set and
 * restarts the cloudflared tunnel when the config changes (subject to a
 * 30-second cooldown to prevent restart storms during batch reconciliation).
 *
 * Two tunnel modes:
 *   Proxy mode (preferred): All ingress routes through a single wildcard
 *     hostname pointing at the slot-proxy container, which routes by Host header.
 *   Direct mode: Per-service ingress rules generated for each exposed service,
 *     used when the slot-proxy is not running.
 */
import fs from "fs";
import path from "path";
import { sh } from "./podman";
import type { Service } from "./types";
import { CLOUDFLARED_CONFIG, RESTART_COOLDOWN, RUNTIME_FILE } from "./config";

// ── Helpers ──

let lastRestart = 0;

/**
 * Format a hostname for YAML output.  Hostnames containing glob characters
 * (e.g. *.ffilt.us) must be quoted so cloudflared doesn't interpret them
 * as glob patterns.
 *
 * Cloudflared's YAML parser treats unquoted strings containing `*`, `?`,
 * `[`, etc. as glob patterns rather than literal hostname values, which
 * would prevent the tunnel from matching the intended hostname.
 */
function fmtHostname(h: string): string {
  return /[*?\[\]{}!|&]/.test(h) ? `"${h}"` : h;
}

/**
 * Read the current runtime state from runtime/services.json.
 * Returns an empty object on any read error (e.g. file missing during startup).
 */
function readRuntime(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Read runtime/services.json and find the slot-proxy's port, if any.
 * When the slot-proxy is active, all tunnel traffic routes through it
 * rather than generating per-service ingress rules.
 *
 * If the WAF_PORT environment variable is set and slot-proxy is active,
 * the tunnel routes to the WAF port instead of slot-proxy directly,
 * inserting a Web Application Firewall between Cloudflare and the proxy.
 */
function getProxyPort(runtime: Record<string, any>): number | null {
  const proxyPort = runtime["slot-proxy"]?.port || null;
  const wafPort = process.env.WAF_PORT;
  if (wafPort && proxyPort) {
    return parseInt(wafPort, 10);
  }
  return proxyPort;
}

/**
 * Resolve the actual port a service is listening on at runtime,
 * preferring the active slot port over the configured port.
 */
function getActualPort(svc: Record<string, any>): number | null {
  if (svc.slots && svc.activeSlot && svc.slots[svc.activeSlot]?.port) {
    return svc.slots[svc.activeSlot].port;
  }
  return svc.port || null;
}

// ── Config Generation ──

/**
 * Write the cloudflared config.yml based on exposed services and restart
 * the tunnel if the config changed and the cooldown period has elapsed.
 */
export function writeCloudflaredConfig(services: Service[]): void {
  const enabled = services.filter((s) => s.expose?.enabled);
  if (enabled.length === 0) return;

  const runtime = readRuntime();
  const proxyPort = getProxyPort(runtime);

  const tunnel = enabled[0].expose!.tunnel || "agent";

  // ── Two tunnel modes ──
  //
  //   Proxy mode:
  //     All service ingress routes through a single wildcard hostname
  //     (e.g. *.ffilt.us) pointing at the slot-proxy container, which
  //     routes by Host header.  This is the preferred production mode
  //     because it avoids per-service cloudflared restarts as services
  //     come and go.
  //
  //   Direct mode:
  //     One ingress rule per exposed service with its specific hostname
  //     and resolved port.  Used when the slot-proxy is not running.
  //     Each service gets its own tunnel entry so cloudflared routes
  //     directly to the container.  Changes require a tunnel restart.
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
      .flatMap((s) => {
        const port =
          getActualPort(runtime[s.name] || {}) ||
          (s.container && (s.container.host_port || s.container.port)) ||
          s.service?.port;
        const entries = [{ hostname: s.expose!.hostname!, service: `http://127.0.0.1:${port}` }];
        // Add ingress entries for each additional hostname (e.g., profile-scoped URLs)
        if (s.expose?.hostnames && Array.isArray(s.expose.hostnames)) {
          for (const hn of s.expose.hostnames) {
            entries.push({ hostname: hn, service: `http://127.0.0.1:${port}` });
          }
        }
        return entries;
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
    // Cooldown gate: prevent restart storms by requiring at least RESTART_COOLDOWN
    // (30s) between tunnel restarts.  When many services reconcile at once, only
    // the first config change triggers an immediate restart; subsequent changes
    // within the window log a deferred message instead.
    // Note: this means a batch of N service changes only produces 1 tunnel
    // restart at most every 30s, which is safe because the tunnel just needs
    // the final state — intermediate states are skipped.
    const now = Date.now();
    // Threshold check: if enough time has elapsed since the last restart,
    // apply immediately.  Otherwise defer — the next config change or the
    // next reconcile tick's timeout expiration will trigger it.
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
