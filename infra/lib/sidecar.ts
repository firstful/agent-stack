// ── Imports ──

import { execSync } from "child_process";
import type { Service, SidecarConfig } from "./types";
import {
  containerExists,
  containerRunning,
  containerLabel,
  ensureNetwork,
  buildDiscoveryEnv,
} from "./podman";
import { CONTAINER_LABEL, NETWORK_NAME, sidecarContainerName } from "./config";
import { fetchSecrets, interpolateSecrets, discoverRequiredSecrets } from "./services";

// ── Shell Wrapper ──

/**
 * Execute a shell command with inherited stdio.
 * Local copy of podman.ts's `sh` for sidecar-specific operations
 * (pull, start, run, stop, rm).  This avoids a cross-module dependency
 * on podman.ts for these basic operations while keeping the interface
 * consistent.
 */
export function sh(cmd: string): Buffer {
  return execSync(cmd, { stdio: "inherit" }) as unknown as Buffer;
}

// ── Image Management ──

/**
 * Check whether a podman image exists locally.
 * Returns true if the image is found, false otherwise (no error thrown).
 */
export function imageExists(image: string): boolean {
  try {
    execSync(`podman image exists ${image}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a sidecar image is pulled locally.
 */
export function ensureImage(image: string): void {
  if (imageExists(image)) return;
  console.log(`[sidecar] pulling ${image}...`);
  sh(`podman pull ${image}`);
}

// ── Sidecar Lifecycle ──

/**
 * Ensure a single sidecar container exists and is running.
 */
export function ensureSidecar(
  service: Service,
  sidecar: SidecarConfig,
  allServices: Service[]
): void {
  const name = sidecarContainerName(service.name, sidecar.name);
  ensureImage(sidecar.image);

  if (containerExists(name)) {
    // Container already exists — ensure it's running, no further action needed
    if (!containerRunning(name)) {
      console.log(`[sidecar] starting ${name}`);
      sh(`podman start ${name}`);
    }
    return;
  }

  const vol = (sidecar.volumes || [])
    .map((v) => `-v ${v}`)
    .join(" ");
  const staticEnv = sidecar.env || {};

  // Resolve vault secrets: auto-discover from {SECRETS.KEY} patterns in env,
  // falling back to the explicit secrets array for backward compatibility
  const vaultEnv: Record<string, string> = {};
  const interpolatedKeys = discoverRequiredSecrets(staticEnv);
  const secretKeys = interpolatedKeys.length > 0 ? interpolatedKeys : (sidecar.secrets || []);
  if (secretKeys.length > 0) {
    Object.assign(vaultEnv, fetchSecrets(service.name, secretKeys));
    console.log(`[sidecar] ${name}: resolved ${Object.keys(vaultEnv).length} secrets from vault (auto-discovered: ${interpolatedKeys.length > 0 ? interpolatedKeys.join(', ') : 'declared array'})`);
  }

  // Interpolate vault secrets into static env values (replaces {SECRETS.KEY} patterns)
  const interpolated = interpolateSecrets(staticEnv, vaultEnv);

  // Merge: vault secrets override interpolated env (so direct vault values win)
  const mergedEnv = { ...interpolated, ...vaultEnv };
  const env = Object.entries(mergedEnv)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  const cmd = (sidecar.command || []).join(" ");
  const discovery = buildDiscoveryEnv(allServices);

  ensureNetwork();
  console.log(`[sidecar] creating ${name} (${sidecar.image})`);
  try {
    sh(
      `podman run -d --label ${containerLabel()} --name ${name} --network ${NETWORK_NAME} --add-host host.containers.internal:host-gateway --add-host runtime:host-gateway --add-host agent-stack:host-gateway ${discovery} ${env} ${vol} ${sidecar.image} ${cmd}`
    );
  } catch (e: any) {
    console.error(`[sidecar] ${name} failed: ${e.message}`);
    throw e;
  }
}

/**
 * Ensure all sidecars defined for a service are running.
 */
export function ensureSidecars(
  service: Service,
  allServices: Service[]
): void {
  if (!service.container?.sidecars) return;
  for (const sc of service.container.sidecars) {
    ensureSidecar(service, sc, allServices);
  }
}

// ── Cleanup ──

/**
 * Stop and remove a container, ignoring errors.
 */
export function stopAndRemoveContainer(name: string): void {
  try {
    if (containerRunning(name)) sh(`podman stop ${name}`);
    if (containerExists(name)) sh(`podman rm ${name}`);
  } catch {
    // best effort
  }
}

/**
 * Remove a single sidecar container.
 */
export function removeSidecar(
  serviceName: string,
  sidecar: SidecarConfig
): void {
  const name = sidecarContainerName(serviceName, sidecar.name);
  if (containerExists(name)) {
    console.log(`[sidecar] removing ${name}`);
    stopAndRemoveContainer(name);
  }
}

/**
 * Remove all sidecar containers for a service.
 */
export function removeSidecars(service: Service): void {
  if (!service.container?.sidecars) return;
  for (const sc of service.container.sidecars) {
    removeSidecar(service.name, sc);
  }
}
