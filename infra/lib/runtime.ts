/**
 * runtime.ts — Runtime state persistence for the agent-stack controller.
 *
 * Reads the active slot markers written by reconcile.ts and writes the
 * combined service state to runtime/services.json.  This file is the
 * single source of truth consumed by the HTTP API (/api/status,
 * /api/services/:name) and the web dashboard.
 *
 * On each reconciliation tick, writeRuntimeState() captures:
 *   - Slot status (a/b), active slot, port per slot
 *   - Sidecar running state and ports
 *   - Exposure & rate-limit configuration
 *   - Systemd unit running state and port
 */
import fs from "fs";
import path from "path";
import { containerRunning, getContainerPort } from "./podman";
import { isRunning as isSystemdRunning } from "./systemd";
import type { Service } from "./types";
import {
  RUNTIME_DIR,
  slotContainerName,
  slotMarker,
  sidecarContainerName,
} from "./config";

// ── Slot Resolution ──

/**
 * Read the slot marker file for a service, defaulting to "a" if absent.
 * The slot marker is written by reconcile.ts during slot swaps and lives
 * at /tmp/stack.<name>.slot.
 *
 * On first deploy (no marker yet), the service starts on slot "a".
 * @param name - Service name
 * @returns "a" or "b", depending on which slot marker says is active
 */
function readSlot(name: string): string {
  try {
    return fs.readFileSync(slotMarker(name), "utf-8").trim();
  } catch {
    return "a";
  }
}

// ── State Persistence ──

/**
 * Persist the current state of all services to runtime/services.json.
 * This is the single source of truth consumed by the HTTP API
 * (/api/status, /api/services/:name) and the web dashboard.
 *
 * For container services, captures:
 *   - Slot status (a/b), active slot, port per slot
 *   - Sidecar running state and ports
 *   - Exposure & rate-limit configuration
 *
 * For systemd services, captures:
 *   - Systemd unit running state
 *   - Service port and exposure config
 *
 * Side effects: overwrites runtime/services.json atomically via JSON.stringify.
 * Creates RUNTIME_DIR if it does not exist.
 */
export function writeRuntimeState(services: Service[]): void {
  const state: Record<string, any> = {};
  for (const s of services) {
    const isContainer = !!s.container;
    const base = { file: s._file, hash: s._hash, name: s.name, repo: s.repo || null, logo: s.logo || null };

    if (isContainer) {
      const slotA = slotContainerName(s.name, "a");
      const slotB = slotContainerName(s.name, "b");
      const saRunning = containerRunning(slotA);
      const sbRunning = containerRunning(slotB);
      const hasOld = !saRunning && !sbRunning && containerRunning(s.name);

      let activeSlot = readSlot(s.name);
      if (activeSlot === "a" && !saRunning && sbRunning) activeSlot = "b";
      if (activeSlot === "b" && !sbRunning && saRunning) activeSlot = "a";

      const slots: Record<string, { port: number | null; running: boolean }> = {
        a: { port: getContainerPort(slotA), running: saRunning },
        b: { port: getContainerPort(slotB), running: sbRunning },
      };

      const sidecars: Record<string, { running: boolean; port: number | null }> = {};
      if (s.container?.sidecars) {
        for (const sc of s.container.sidecars) {
          const scName = sidecarContainerName(s.name, sc.name);
          sidecars[sc.name] = {
            running: containerRunning(scName),
            port: sc.port || null,
          };
        }
      }

      state[s.name] = {
        ...base,
        container: s.container || null,
        service: null,
        expose: s.expose || null,
        rateLimit: s.rateLimit || null,
        hostnames: s.expose?.enabled ? s.expose.hostnames : undefined,
        activeSlot,
        slots,
        sidecars: Object.keys(sidecars).length > 0 ? sidecars : undefined,
        port: slots[activeSlot]?.port || s.container?.host_port || s.container?.port,
        exposed: s.expose?.enabled ? s.expose.hostname : false,
        running: saRunning || sbRunning || hasOld,
      };
    } else {
      state[s.name] = {
        ...base,
        container: null,
        service: s.service || null,
        expose: s.expose || null,
        rateLimit: s.rateLimit || null,
        hostnames: s.expose?.enabled ? s.expose.hostnames : undefined,
        running: isSystemdRunning(s.name),
        port: s.service?.port,
        exposed: s.expose?.enabled ? s.expose.hostname : false,
      };
    }
  }
  const out = JSON.stringify(state, null, 2);
  if (!fs.existsSync(RUNTIME_DIR))
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_DIR, "services.json"), out);
}
