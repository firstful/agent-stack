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

process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaught exception: ${err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(`[fatal] unhandled rejection: ${(err as Error).message}`);
  process.exit(1);
});

let reconciling = false;

function send(msg: any): void {
  try {
    parentPort!.postMessage(msg);
  } catch {
    // parent might be gone
  }
}

function reconcile(): void {
  if (reconciling) return;
  reconciling = true;
  try {
    tick();
    const desired = loadDesired();
    const desiredNames = new Set(desired.map((s) => s.name));

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
    for (const service of desired) {
      try {
        if (service.service) {
          if (managedContainerSet.has(service.name)) {
            const sidecarNames = (service.container?.sidecars || []).map((sc) =>
              sidecarContainerName(service.name, sc.name)
            );
            removeContainer(service.name, sidecarNames);
          }
          ensureSystemdService(service);
        } else {
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

    try {
      writeRuntimeState(desired);
    } catch (e: any) {
      console.error(`[runtime] failed to write runtime state: ${e.message}`);
    }

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

parentPort!.on("message", (msg) => {
  if (msg === "reconcile") {
    reconcile();
    send({ type: "reconcile_done" });
  }
});

setTimeout(reconcile, 100);
setInterval(reconcile, 5000);
