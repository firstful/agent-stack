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

// ── Fatal error handling ──

process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaught exception: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`[fatal] unhandled rejection: ${(err as Error).message}`);
  process.exit(1);
});

let reconciling = false;

// ── Message bridge ──

function send(msg: any): void {
  // Post a message back to the parent controller thread.
  // Errors are silently swallowed when the parent has exited.
  try {
    parentPort!.postMessage(msg);
  } catch {
    // parent might be gone
  }
}

// ── Main reconciliation loop ──

function reconcile(): void {
  if (reconciling) return;
  reconciling = true;
  try {
    tick(); // advance cycle counter for build backoff tracking
    const desired = loadDesired();
    const desiredNames = new Set(desired.map((s) => s.name));

    const managedContainers = getManagedContainers();
    const managedContainerSet = new Set(managedContainers);
    // ── Garbage-collect orphaned containers ──
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
    // ── Garbage-collect orphaned systemd services ──
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
    // ── Ensure each desired service is running ──
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
    // ── Write Cloudflare Tunnel config ──
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

    // ── Persist runtime state ──
    try {
      writeRuntimeState(desired);
    } catch (e: any) {
      console.error(`[runtime] failed to write runtime state: ${e.message}`);
    }

    // ── Prune unused images ──
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
    reconciling = false;
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

setTimeout(reconcile, 100);
setInterval(reconcile, 5000);
