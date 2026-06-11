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
import { getStrategyType } from "./types";
import {
  RUNTIME_DIR,
  slotContainerName,
  slotMarker,
  sidecarContainerName,
  queueMarker,
  canaryMarker,
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

/** Read the queue counter for a service (0 if no queue file or queue disabled). */
function readQueueCount(name: string): number {
  try {
    return parseInt(fs.readFileSync(queueMarker(name), "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Read the canary state from the marker file, or null if not active. */
function readCanaryState(name: string): { slot: string; startTime: number; weight?: number } | null {
  try {
    const raw = fs.readFileSync(canaryMarker(name), "utf-8");
    const state = JSON.parse(raw);
    if (!state.slot) return null;
    return { slot: state.slot, startTime: state.startTime, weight: state.weight };
  } catch {
    return null;
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
    const base = { file: s._file, hash: s._hash, name: s.name, repo: s.repo || null, logo: s.logo || null, queue: readQueueCount(s.name) };

    if (isContainer) {
      const slotA = slotContainerName(s.name, "a");
      const slotB = slotContainerName(s.name, "b");

      // Recreate strategy: no slot containers — report a flat container state
      if (getStrategyType(s.strategy) === "recreate") {
        const cRunning = containerRunning(s.name);
        const actualPort = getContainerPort(s.name) || s.container?.host_port || s.container?.port;
        state[s.name] = {
          ...base,
          container: s.container || null,
          service: null,
          expose: s.expose || null,
          rateLimit: s.rateLimit || null,
          hostnames: s.expose?.enabled ? s.expose.hostnames : undefined,
          running: cRunning,
          port: actualPort,
          exposed: s.expose?.enabled ? s.expose.hostname : false,
        };
        continue;
      }

      const saRunning = containerRunning(slotA);
      const sbRunning = containerRunning(slotB);
      // Detect an old-style (pre-slot-migration) container: neither slot a
      // nor slot b exists, but an unqualified container with the service name
      // is still running.  This transitional state is cleared once both slots
      // are established.
      const hasOld = !saRunning && !sbRunning && containerRunning(s.name);

      let activeSlot = readSlot(s.name);
      // Slot marker fallback: if the marker says "a" but slot A is dead and
      // slot B is running, correct to B (and vice versa).  This handles
      // crash-recovery scenarios where the marker file is stale.
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
        canary: readCanaryState(s.name) || undefined,
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
