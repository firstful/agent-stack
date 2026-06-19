/**
 * reconcile-worker.ts — Background reconciliation loop for agent-stack.
 *
 * Runs as a worker_thread spawned by controller.ts.  On each tick (every 5 s):
 *   1. Load the desired service set (repo agent-stack.json + desired/*.json)
 *   2. Garbage-collect managed containers that are no longer in the desired set
 *   3. Garbage-collect old systemd services not in the desired set
 *   4. For each desired service, ensure it's running (container or systemd)
 *   5. Write cloudflared tunnel config if exposure is enabled
 *   6. Persist runtime state for the controller's /api/status endpoint
 *   7. Prune unused podman images
 *   8. Send a status_update message back to the parent thread
 */

import {
  loadDesired,
} from "./lib/services";
import {
  ensureContainer,
  removeContainer,
  tick,
  getBuildErrors,
} from "./lib/reconcile";
import {
  ensure as ensureSystemdService,
  remove as removeSystemdService,
  getManaged as getManagedSystemdServices,
} from "./lib/systemd";
import { writeCloudflaredConfig } from "./lib/cloudflared";
import { writeRuntimeState } from "./lib/runtime";
import { getManagedContainers, sh } from "./lib/podman";
import { sidecarContainerName, baseServiceName } from "./lib/config";
import { parentPort } from "worker_threads";
import fs from "fs";
import path from "path";

// ── Git ref watcher ──
// On Linux, fs.watch() does NOT support recursive=true, so we watch
// individual files: .git/HEAD (branch switch) + the current branch ref
// (commit detection).  When HEAD changes we re-resolve and re-watch.

const REPO_DIR = "/srv/agent-stack";
const GIT_DIR = path.join(REPO_DIR, ".git");
const HEAD_FILE = path.join(GIT_DIR, "HEAD");
const HEARTBEAT_MS = 300_000; // 5-minute safety-net interval

let branchRefWatcher: fs.StatWatcher | null = null;

/**
 * Resolve the current branch's ref file path from .git/HEAD.
 * Parses the HEAD file (e.g. "ref: refs/heads/main") and returns
 * the absolute path to the branch ref file.  Returns null if HEAD
 * is detached or unreadable.
 *
 * The returned file path is used by watchCurrentBranch() to stat-poll
 * for new commits.  When the ref file's mtime changes, a commit
 * has landed.
 */
function currentBranchRef(): string | null {
  try {
    const head = fs.readFileSync(HEAD_FILE, "utf-8").trim();
    const m = head.match(/^ref:\s*(.+)$/);
    return m ? path.join(GIT_DIR, m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Set up or update the current branch ref watcher using stat polling.
 * On Linux, fs.watch() does NOT support recursive=true, so we watch
 * individual files: .git/HEAD (branch switch) + the current branch ref
 * (commit detection).  When HEAD changes we re-resolve and re-watch.
 *
 * Uses watchFile (stat polling) instead of watch (inotify) because
 * ref files may be owned by a different user (root writing the ref,
 * controller running as reeds).  Polling interval matches the
 * heartbeat to avoid unnecessary stat calls.
 */
function watchCurrentBranch(): void {
  if (branchRefWatcher) {
    branchRefWatcher.stop();
    branchRefWatcher = null;
  }
  const refFile = currentBranchRef();
  if (!refFile) return;
  try {
    // Use watchFile (stat polling) instead of watch (inotify) because
    // ref files may be owned by a different user (root writing the ref,
    // controller running as reeds).  Polling interval matches the
    // heartbeat to avoid unnecessary stat calls.
    branchRefWatcher = fs.watchFile(refFile, { interval: 5000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        console.log(`[git-watch] ref changed — reconciling`);
        reconcile();
      }
    });
    console.log(`[git-watch] watching (poll) ${refFile}`);
  } catch (e: any) {
    console.error(`[git-watch] failed to watch ${refFile}: ${e.message}`);
  }
}

/**
 * Watch .git/HEAD for branch switches using stat polling.
 * On detecting a HEAD change, re-resolves and re-watches the
 * current branch ref file so commit detection continues on
 * the new branch.
 */
function watchHead(): void {
  try {
    fs.watchFile(HEAD_FILE, { interval: 5000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        console.log(`[git-watch] HEAD changed — re-resolving branch`);
        watchCurrentBranch(); // re-watch the new branch's ref
        reconcile();
      }
    });
    console.log(`[git-watch] watching (poll) ${HEAD_FILE}`);
  } catch (e: any) {
    console.error(`[git-watch] failed to watch HEAD: ${e.message}`);
  }
}

// ── Config drift check ──

/**
 * Check that per-service terraform tfvars files define the same variables
 * in both environments. For each service with a terraform/ directory,
 * compares env/dev.tfvars against env/prod.tfvars.
 * Pushes any missing vars into the provided reconcileErrors array.
 */
function checkTerraformVars(
  desired: { name: string; repo?: string }[],
  errors: { service: string; error: string; time: string }[]
): void {
  const now = new Date().toISOString();

  for (const service of desired) {
    if (!service.repo) continue;
    const tfDir = path.join(service.repo, "terraform", "env");
    if (!fs.existsSync(tfDir)) continue;

    const devVars = path.join(tfDir, "dev.tfvars");
    const prodVars = path.join(tfDir, "prod.tfvars");

    // Parse a tfvars file into a set of defined keys
    function definedKeys(file: string): Set<string> {
      const keys = new Set<string>();
      try {
        const content = fs.readFileSync(file, "utf-8");
        for (const line of content.split("\n")) {
          const m = line.match(/^(\w+)\s*=/);
          if (m) keys.add(m[1]);
        }
      } catch {
        // file doesn't exist yet — no keys defined
      }
      return keys;
    }

    const devKeys = definedKeys(devVars);
    const prodKeys = definedKeys(prodVars);

    for (const v of devKeys) {
      if (!prodKeys.has(v)) {
        errors.push({
          service: `terraform/${service.name}`,
          error: `var "${v}" defined in dev.tfvars but missing in prod.tfvars`,
          time: now,
        });
      }
    }
    for (const v of prodKeys) {
      if (!devKeys.has(v)) {
        errors.push({
          service: `terraform/${service.name}`,
          error: `var "${v}" defined in prod.tfvars but missing in dev.tfvars`,
          time: now,
        });
      }
    }
  }
}

// ── Fatal error handling ──

process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaught exception: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`[fatal] unhandled rejection: ${(err as Error).message}`);
  process.exit(1);
});

/** Re-entrancy guard: prevents overlapping reconcile() calls when Git
 * watchers and heartbeat timer fire simultaneously.  The guard is set
 * at the start of reconcile() and cleared in the finally block so
 * errors don't deadlock the loop. */
let reconciling = false;

// ── Message bridge ──

/**
 * Post a message back to the parent controller thread.
 * Errors are silently swallowed when the parent has exited
 * (e.g. during shutdown race conditions).
 */
function send(msg: any): void {
  try {
    parentPort!.postMessage(msg);
  } catch {
    // parent might be gone
  }
}

// ── Main reconciliation loop ──

/**
 * Ensure all services match the desired state.
 *
 * Called on the heartbeat timer, on git push (via fs stat polling),
 * on parent-thread request, and during the initial startup delay.
 *
 * The loop is guarded against re-entry by the `reconciling` flag:
 * if a git event fires while a tick is in progress, the second
 * call is silently dropped.  The guard is cleared in a finally
 * block so errors never deadlock the loop.
 *
 * Steps (in order):
 *   1. Advance the cycle counter (for build backoff tracking)
 *   2. Load desired service set from repo + config files
 *   3. Garbage-collect orphaned containers (not in desired set)
 *   4. Garbage-collect orphaned systemd services
 *   5. Ensure each desired service is running (container or systemd)
 *   6. Write cloudflared tunnel config
 *   7. Persist runtime state to services.json
 *   8. Prune unused podman images
 *   9. Send status_update message back to the parent thread
 */
function reconcile(): void {
  if (reconciling) return;
  reconciling = true;
  try {
    tick(); // advance cycle counter for build backoff tracking
    const desired = loadDesired();
    const desiredNames = new Set(desired.map((s) => s.name));

    // ── Step 1: Garbage-collect orphaned containers ──
    // Walk every managed container on the system.  Containers that are not
    // in the desired service set AND not a slot/sidecar of a desired service
    // are removed.  This handles:
    //   - Services deleted from config
    //   - Orphaned slot containers from aborted swaps
    //   - Old-style (non-slotted) containers left after slot migration
    const managedContainers = getManagedContainers();
    const managedContainerSet = new Set(managedContainers);
    for (const name of managedContainers) {
      if (desiredNames.has(name)) continue;
      const baseName = name.replace(/--[ab]$/, '');
      if (baseName !== name && desiredNames.has(baseName)) continue;
      const svcBase = baseServiceName(name);
      if (svcBase && desiredNames.has(svcBase)) {
        const service = desired.find((s) => s.name === svcBase);
        if (
          service &&
          service.container?.sidecars?.some(
            (sc) => sidecarContainerName(svcBase, sc.name) === name
          )
        )
          continue;
      }
      removeContainer(name);
    }

    const managedServices = getManagedSystemdServices();
    // ── Step 2: Garbage-collect orphaned systemd services ──
    for (const name of managedServices) {
      if (!desiredNames.has(name)) {
        removeSystemdService(name);
      }
    }

    const reconcileErrors: {
      service: string;
      error: string;
      time: string;
    }[] = [];
    // ── Config drift check: per-service tfvars parity ──
    checkTerraformVars(desired, reconcileErrors);

    // ── Step 3: Ensure each desired service is running ──
    for (const service of desired) {
      try {
        if (service.service) {
          // This is a systemd service.  If a container with the same name
          // exists (from a previous config), remove it first to avoid
          // conflicts between the container and systemd-managed instance.
          if (managedContainerSet.has(service.name)) {
            const sidecarNames = (service.container?.sidecars || []).map((sc) =>
              sidecarContainerName(service.name, sc.name)
            );
            removeContainer(service.name, sidecarNames);
          }
          ensureSystemdService(service);
        } else {
          // Container-based service.  If a systemd service with the same
          // name exists (from a previous config), remove it first.
          if (getManagedSystemdServices().includes(service.name)) {
            removeSystemdService(service.name);
          }
          ensureContainer(service, desired);
        }
      } catch (e: any) {
        console.error(
          `[reconcile] failed to ensure ${service.name}: ${e.message}`
        );
        reconcileErrors.push({
          service: service.name,
          error: e.message,
          time: new Date().toISOString(),
        });
      }
    }

    let lastCloudflaredError: { error: string; time: string } | null = null;
    // ── Step 4: Write Cloudflare Tunnel config ──
    try {
      writeCloudflaredConfig(desired);
    } catch (e: any) {
      console.error(`[cloudflared] ${e.message}`);
      lastCloudflaredError = {
        error: e.message,
        time: new Date().toISOString(),
      };
      reconcileErrors.push({
        service: "cloudflared",
        error: e.message,
        time: new Date().toISOString(),
      });
    }

    // ── Step 5: Persist runtime state ──
    try {
      writeRuntimeState(desired);
    } catch (e: any) {
      console.error(`[runtime] failed to write runtime state: ${e.message}`);
    }

    // ── Step 6: Prune unused images ──
    try {
      sh(`podman image prune -f`);
    } catch {
      // best effort
    }

    send({
      type: "status_update",
      payload: {
        lastReconcile: new Date().toISOString(),
        reconcileErrors,
        buildErrors: getBuildErrors(),
        lastCloudflaredError,
      },
    });
  } finally {
    reconciling = false; // always release the re-entrancy guard, even on error
  }
}

// ── Message handler — trigger reconcile on parent request ──

parentPort!.on("message", (msg) => {
  if (msg === "reconcile") {
    reconcile();
    send({ type: "reconcile_done" });
  }
});

// ── Schedule ──

// First reconcile: run immediately on startup
setTimeout(reconcile, 100);

// Git ref watcher: detect commits (branch ref change) and branch switches
// (HEAD change).  On Linux we watch individual files since fs.watch does
// not support recursive mode.
watchCurrentBranch();
watchHead();

// Safety-net heartbeat: catch runtime failures (crashed containers,
// sidecar exits) that aren't triggered by git changes
setInterval(reconcile, HEARTBEAT_MS);
