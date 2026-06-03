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

/**
 * Runtime state persistence for the agent-stack infrastructure.
 *
 * Writes the current service state (container slots, ports, sidecars,
 * systemd status) to runtime/services.json, which the controller's
 * /api/status and /api/services endpoints consume.
 */

/**
 * Read the slot marker file for a service, defaulting to "a" if absent.
 */
function readSlot(name: string): string {
  try {
    return fs.readFileSync(slotMarker(name), "utf-8").trim();
  } catch {
    return "a";
  }
}

/**
 * Persist the current state of all services to runtime/services.json.
 * Captures container slot status, port assignments, sidecar status,
 * systemd service running state, and exposure configuration.
 */
export function writeRuntimeState(services: Service[]): void {
  const state: Record<string, any> = {};
  for (const s of services) {
    const isContainer = !!s.container;
    const base = { file: s._file, hash: s._hash, name: s.name, repo: s.repo || null };

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
