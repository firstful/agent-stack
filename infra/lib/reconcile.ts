import fs from "fs";
import {
  imageExists,
  buildImage,
  containerExists,
  runContainer,
  containerRunning,
  getContainerPort,
  getUsedHostPorts,
  waitForHealthy,
  sh,
} from "./podman";
import { ensureSidecars, removeSidecars } from "./sidecar";
import { ensureServiceClone } from "./services";
import type { Service } from "./types";
import {
  AUTO_PORT_START,
  AUTO_PORT_END,
  hashMarker,
  slotMarker,
  slotContainerName,
  oppositeSlot,
  HEALTH_CHECK_TIMEOUT,
} from "./config";

const buildBackoffs: Record<string, { retryCycle: number; failures: number }> =
  {};
const buildErrors: Record<
  string,
  { error: string; time: string; failures: number; retryIn: number }
> = {};
let cycle = 0;

export function tick(): void {
  cycle++;
}

export function getBuildErrors(): {
  service: string;
  error: string;
  time: string;
  failures: number;
  retryIn: number;
}[] {
  return Object.entries(buildErrors).map(([name, err]) => ({
    service: name,
    error: err.error,
    time: err.time,
    failures: err.failures,
    retryIn: err.retryIn,
  }));
}

function clearBuildError(name: string): void {
  delete buildErrors[name];
}

// Allocate a fresh port for a slot, excluding the service's current host_port.
function allocateFreshPort(
  service: Service,
  allServices: Service[],
  forSlot: string
): number {
  const usedPorts = getUsedHostPorts();

  // Exclude this service's active port so idle gets a different one
  if (service.container?.host_port !== undefined) {
    usedPorts.add(service.container.host_port);
  }

  for (const s of allServices) {
    if (s.name === service.name) continue;
    if (s.container?.host_port !== undefined) {
      usedPorts.add(s.container.host_port);
    }
  }

  for (let p = AUTO_PORT_START; p <= AUTO_PORT_END; p++) {
    if (!usedPorts.has(p)) {
      console.log(`[port] ${service.name} slot ${forSlot} → ${p}`);
      return p;
    }
  }

  throw new Error(
    `[port] ${service.name} no free port in range ${AUTO_PORT_START}-${AUTO_PORT_END}`
  );
}

function readSlot(name: string): string {
  try {
    return fs.readFileSync(slotMarker(name), "utf-8").trim();
  } catch {
    return "a";
  }
}

function writeSlot(name: string, slot: string): void {
  fs.writeFileSync(slotMarker(name), slot);
}

function stopAndRemove(containerName: string): void {
  try {
    if (containerRunning(containerName)) sh(`podman stop ${containerName}`);
    if (containerExists(containerName)) sh(`podman rm ${containerName}`);
  } catch {
    // best effort
  }
}

export function ensureContainer(
  service: Service,
  allServices: Service[]
): void {
  const name = service.name;
  const marker = hashMarker(name);

  // Ensure sidecars are running before the primary container
  ensureSidecars(service, allServices);

  const hashChanged =
    !fs.existsSync(marker) ||
    fs.readFileSync(marker, "utf-8") !== service._hash;

  const backoff = buildBackoffs[name];
  const needsBuild = !imageExists(name) || hashChanged;
  let built = false;

  // ── Build ─────────────────────────────────────────────────
  if (needsBuild) {
    if (backoff && cycle < backoff.retryCycle) {
      console.log(
        `[backoff] ${name} — skip build (${
          backoff.retryCycle - cycle
        } cycles remaining)`
      );
    } else {
      try {
        const clonePath = ensureServiceClone(service);
        if (clonePath) service.repo = clonePath;
        buildImage(service);
        delete buildBackoffs[name];
        clearBuildError(name);
        built = true;
      } catch (e: any) {
        const failures = (backoff?.failures || 0) + 1;
        const wait = 5 * Math.pow(2, failures - 1);
        buildBackoffs[name] = { retryCycle: cycle + wait, failures };
        buildErrors[name] = {
          error: e.message,
          time: new Date().toISOString(),
          failures,
          retryIn: wait * 5,
        };
        console.error(
          `[backoff] ${name} — build #${failures} failed, retry in ${wait} cycles (${wait * 5}s)`
        );
        return;
      }
    }
  }

  if (!imageExists(name)) return;

  // ── Detect existing containers ────────────────────────────
  const slotA = slotContainerName(name, "a");
  const slotB = slotContainerName(name, "b");

  const hasOldContainer = containerExists(name) && !containerExists(slotA) && !containerExists(slotB);
  const hasSlotA = containerExists(slotA);
  const hasSlotB = containerExists(slotB);

  let activeSlot = readSlot(name);
  // If the marker says "a" but slot A doesn't exist, fall back
  if (activeSlot === "a" && !hasSlotA && hasSlotB) activeSlot = "b";
  if (activeSlot === "b" && !hasSlotB && hasSlotA) activeSlot = "a";

  const activeName = hasOldContainer
    ? name
    : slotContainerName(name, activeSlot);

  // ── First deploy ──────────────────────────────────────────
  if (!hasOldContainer && !hasSlotA && !hasSlotB) {
    console.log(`[deploy] ${name} — first deploy on slot a`);
    const port = allocateFreshPort(service, allServices, "a");
    service.container!.host_port = port;
    runContainer(service, allServices, { containerName: slotA, hostPort: port });
    writeSlot(name, "a");
    fs.writeFileSync(marker, service._hash);
    return;
  }

  // ── Slot swap (hash changed) ──────────────────────────────
  if (built && (hasSlotA || hasSlotB || hasOldContainer)) {
    const idleSlot = oppositeSlot(activeSlot);
    const idleName = slotContainerName(name, idleSlot);
    const idlePort = allocateFreshPort(service, allServices, idleSlot);

    console.log(`[swap] ${name}: building slot ${idleSlot} on port ${idlePort}`);

    runContainer(service, allServices, {
      containerName: idleName,
      hostPort: idlePort,
    });

    if (waitForHealthy(idleName, idlePort, HEALTH_CHECK_TIMEOUT)) {
      console.log(
        `[swap] ${name}: slot ${idleSlot} healthy, swapping (${activeSlot} → ${idleSlot})`
      );

      // Update service port to point at the new active slot
      service.container!.host_port = idlePort;
      writeSlot(name, idleSlot);
      fs.writeFileSync(marker, service._hash);

      // Remove old active container
      if (hasOldContainer) {
        stopAndRemove(name);
      } else {
        stopAndRemove(slotContainerName(name, activeSlot));
      }
    } else {
      console.error(
        `[swap] ${name}: slot ${idleSlot} failed health check, rolling back`
      );
      stopAndRemove(idleName);
      // Reset port allocation so next tick reattempts
    }
    return;
  }

  // ── Ensure active container is running ────────────────────
  if (!containerRunning(activeName)) {
    console.log(`[start] ${name} (slot ${activeSlot})`);
    try {
      sh(`podman start ${activeName}`);
    } catch {
      console.error(`[start] ${name} failed, recreating`);
      stopAndRemove(activeName);
      try {
        runContainer(service, allServices, {
          containerName: activeName,
          hostPort: service.container!.host_port,
        });
      } catch (e: any) {
        console.error(`[recreate] ${name} failed: ${e.message}`);
      }
    }
  }

  // ── Cleanup: remove old-style container after slot migration ──
  if (hasOldContainer && (hasSlotA || hasSlotB)) {
    console.log(`[cleanup] ${name}: removing old-style container`);
    stopAndRemove(name);
  }

  // ── Cleanup: remove orphaned idle slot (shouldn't normally exist) ──
  if (built) return; // swap case already handled above
  const idleSlot = oppositeSlot(activeSlot);
  const idleName = slotContainerName(name, idleSlot);
  if (containerExists(idleName) && !containerRunning(idleName)) {
    console.log(`[cleanup] ${name}: removing dead idle slot ${idleSlot}`);
    stopAndRemove(idleName);
  }
}

export function removeContainer(name: string, sidecarNames?: string[]): void {
  console.log(`[cleanup] removing ${name}`);
  const slots = [name, slotContainerName(name, "a"), slotContainerName(name, "b")];
  for (const cname of slots) {
    if (containerExists(cname)) {
      stopAndRemove(cname);
    }
  }
  for (const scName of sidecarNames || []) {
    if (containerExists(scName)) {
      stopAndRemove(scName);
    }
  }
  const m = hashMarker(name);
  if (fs.existsSync(m)) fs.unlinkSync(m);
  const sm = slotMarker(name);
  if (fs.existsSync(sm)) fs.unlinkSync(sm);
  delete buildBackoffs[name];
  delete buildErrors[name];
}
