import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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
import { ensureServiceClone, repoContentHashForPath } from "./services";
import type { Service } from "./types";
import {
  AUTO_PORT_START,
  AUTO_PORT_END,
  hashMarker,
  commitHashMarker,
  slotMarker,
  slotContainerName,
  oppositeSlot,
  HEALTH_CHECK_TIMEOUT,
  REPOS_DIR,
} from "./config";

// ── State ──

const buildBackoffs: Record<string, { retryCycle: number; failures: number }> =
  {};
const buildErrors: Record<
  string,
  { error: string; time: string; failures: number; retryIn: number }
> = {};
let cycle = 0;

// ── Tick & Error Tracking ──

/**
 * Increment the reconciliation cycle counter.
 */
export function tick(): void {
  cycle++;
}

/**
 * Return a snapshot of current build errors for the controller's status endpoint.
 */
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

/** Remove the build error tracking entry for a service (on successful build). */
function clearBuildError(name: string): void {
  delete buildErrors[name];
}

// ── Port Allocation ──

/**
 * Allocate a fresh port for a slot, excluding the service's current host_port
 * and all other services' host_ports, plus any host ports already bound by
 * running containers.  Scans AUTO_PORT_START..AUTO_PORT_END (default 4000-4999).
 * @throws if no free port is found in the range
 */
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

// ── Slot Helpers ──

const MONOREPO_ROOT = path.resolve(REPOS_DIR, "..");
const MONOREPO_GIT = path.join(MONOREPO_ROOT, ".git");

/**
 * Check if the latest commit for a service repo path contains
 * [stack skip-build] in its message. When true, the controller
 * defers the rebuild so the agent can make multiple commits
 * without triggering a build per commit.
 */
function isSkipBuild(repoPath: string): boolean {
  if (!repoPath || !repoPath.startsWith(REPOS_DIR)) return false;
  if (!fs.existsSync(MONOREPO_GIT)) return false;
  try {
    const relPath = path.relative(MONOREPO_ROOT, repoPath);
    const msg = execSync(
      `git -C ${MONOREPO_ROOT} log -1 --format=%s -- "${relPath}"`,
      { encoding: "utf-8", timeout: 5000 }
    ).toString().trim();
    return msg.includes("[stack skip-build]");
  } catch {
    return false;
  }
}

/** Read the active slot marker (default "a" if absent). */
function readSlot(name: string): string {
  try {
    return fs.readFileSync(slotMarker(name), "utf-8").trim();
  } catch {
    return "a";
  }
}

/** Write the active slot marker to disk. */
function writeSlot(name: string, slot: string): void {
  fs.writeFileSync(slotMarker(name), slot);
}

// ── Container Lifecycle ──

/** Stop and remove a podman container. Errors are silently swallowed. */
function stopAndRemove(containerName: string): void {
  try {
    if (containerRunning(containerName)) sh(`podman stop ${containerName}`);
    if (containerExists(containerName)) sh(`podman rm ${containerName}`);
  } catch {
    // best effort
  }
}

/**
 * Ensure a single service's container is running, building and blue-green
 * swapping if the source hash has changed.
 */
export function ensureContainer(
  service: Service,
  allServices: Service[]
): void {
  const name = service.name;
  const marker = hashMarker(name);
  const commitMarker = commitHashMarker(name);

  // Ensure sidecars are running before the primary container
  ensureSidecars(service, allServices);

  // ── Stage 1: Commit hash trigger ──
  // Fast O(1) check: did the git commit for this repo change?
  const commitHash = service._hash;
  const commitChanged =
    !fs.existsSync(commitMarker) ||
    fs.readFileSync(commitMarker, "utf-8") !== commitHash;

  // ── Stage 2: Skip-build deferral ──
  // When the commit message contains [stack skip-build] the agent is
  // making multiple commits and doesn't want each one to trigger a
  // rebuild.  We update the commit marker so the next commit (without
  // the flag) detects the change and evaluates properly.
  if (commitChanged && service.repo && isSkipBuild(service.repo)) {
    console.log(
      `[skip-build] ${name}: commit flagged with [stack skip-build], deferring rebuild`
    );
    fs.writeFileSync(commitMarker, commitHash);
    return;
  }

  // ── Stage 3: Content eval (only when commit changed) ──
  // Compute the .stackignore-filtered content hash and compare against
  // the last *built* hash.  If only ignored files changed (README, docs,
  // config metadata) the content hash won't differ and no rebuild occurs.
  let contentHash: string | null = null;
  let contentChanged = false;
  let needsBuild = !imageExists(name);

  if (commitChanged) {
    contentHash = repoContentHashForPath(service.repo!);
    contentChanged =
      !fs.existsSync(marker) ||
      fs.readFileSync(marker, "utf-8") !== contentHash;
    fs.writeFileSync(commitMarker, commitHash);
    if (!contentChanged) {
      console.log(
        `[noop] ${name}: commit changed but content unchanged (ignored files)`
      );
    }
    needsBuild = needsBuild || contentChanged;
  }

  // ── Build ─────────────────────────────────────────────────
  const backoff = buildBackoffs[name];
  let built = false;

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
    // Compute content hash for marker if we didn't need it earlier
    if (!contentHash) contentHash = repoContentHashForPath(service.repo!);
    fs.writeFileSync(marker, contentHash);
    return;
  }

  // ── Slot swap (content hash changed or image rebuilt) ─────
  if (built && (hasSlotA || hasSlotB || hasOldContainer)) {
    const idleSlot = oppositeSlot(activeSlot);
    const idleName = slotContainerName(name, idleSlot);
    const idlePort = allocateFreshPort(service, allServices, idleSlot);

    console.log(`[swap] ${name}: building slot ${idleSlot} on port ${idlePort}`);

    runContainer(service, allServices, {
      containerName: idleName,
      hostPort: idlePort,
    });

    const healthCheckPath = service.container?.healthCheck?.path;
    if (waitForHealthy(idleName, idlePort, HEALTH_CHECK_TIMEOUT, healthCheckPath)) {
      console.log(
        `[swap] ${name}: slot ${idleSlot} healthy, swapping (${activeSlot} → ${idleSlot})`
      );

      // Update service port to point at the new active slot
      service.container!.host_port = idlePort;
      writeSlot(name, idleSlot);
      fs.writeFileSync(marker, contentHash!);

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

/**
 * Remove a service's containers (both slots), sidecars, and marker files.
 */
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
  const cm = commitHashMarker(name);
  if (fs.existsSync(cm)) fs.unlinkSync(cm);
  const sm = slotMarker(name);
  if (fs.existsSync(sm)) fs.unlinkSync(sm);
  delete buildBackoffs[name];
  delete buildErrors[name];
}
