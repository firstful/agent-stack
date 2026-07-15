/**
 * cloudflared.ts — Cloudflare Tunnel config generation for the agent-stack controller.
 *
 * Generates /etc/cloudflared/config.yml from the desired service set and
 * restarts the cloudflared tunnel when the config changes (subject to a
 * 30-second cooldown to prevent restart storms during batch reconciliation).
 *
 * After the slot-proxy merge, the controller IS the proxy on port 80,
 * so all tunnel traffic routes through a single wildcard hostname
 * pointing at 127.0.0.1:80.
 */

// ── Imports ──

import fs from "fs";
import path from "path";
import { sh } from "./podman";
import type { Service } from "./types";
import { CLOUDFLARED_CONFIG, RESTART_COOLDOWN } from "./config";

// ── Helpers & State ──

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

// ── Config Generation ──

/**
 * Write the cloudflared config.yml based on exposed services and restart
 * the tunnel if the config changed and the cooldown period has elapsed.
 *
 * The controller itself handles host-based routing on port 80, so
 * cloudflared always routes all traffic to 127.0.0.1:80 via a single
 * wildcard hostname ingress rule.
 *
 * Cooldown behaviour: after a tunnel restart, subsequent config changes
 * within RESTART_COOLDOWN (30s) are deferred with a log message rather
 * than triggering another restart.  This prevents restart storms when
 * many services reconcile in rapid succession — the tunnel only needs
 * the final config state, so intermediate changes can be safely skipped.
 */
export function writeCloudflaredConfig(services: Service[]): void {
  // Filter to only services with explicit exposure enabled — services that
  // don't set expose.enabled: true are excluded from tunnel ingress.
  const enabled = services.filter((s) => s.expose?.enabled);
  if (enabled.length === 0) return;

  const tunnel = process.env.TUNNEL_ID || enabled[0].expose!.tunnel || "agent";
  const wildcard = process.env.TUNNEL_DOMAIN || "*.ffilt.us";

  const yaml = `tunnel: ${tunnel}
ingress:
  - hostname: ${fmtHostname(wildcard)}
    service: http://127.0.0.1:80
  - service: http_status:404
`;

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
    //
    // This means a batch of N service changes only produces at most 1 tunnel
    // restart every 30s, which is safe because the tunnel just needs the final
    // state — intermediate states are skipped entirely.
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
