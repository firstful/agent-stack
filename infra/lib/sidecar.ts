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

export function sh(cmd: string): Buffer {
  return execSync(cmd, { stdio: "inherit" }) as unknown as Buffer;
}

export function imageExists(image: string): boolean {
  try {
    execSync(`podman image exists ${image}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ensureImage(image: string): void {
  if (imageExists(image)) return;
  console.log(`[sidecar] pulling ${image}...`);
  sh(`podman pull ${image}`);
}

export function ensureSidecar(
  service: Service,
  sidecar: SidecarConfig,
  allServices: Service[]
): void {
  const name = sidecarContainerName(service.name, sidecar.name);
  ensureImage(sidecar.image);

  if (containerExists(name)) {
    if (!containerRunning(name)) {
      console.log(`[sidecar] starting ${name}`);
      sh(`podman start ${name}`);
    }
    return;
  }

  const vol = (sidecar.volumes || [])
    .map((v) => `-v ${v}`)
    .join(" ");
  const env = Object.entries(sidecar.env || {})
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

export function ensureSidecars(
  service: Service,
  allServices: Service[]
): void {
  if (!service.container?.sidecars) return;
  for (const sc of service.container.sidecars) {
    ensureSidecar(service, sc, allServices);
  }
}

export function stopAndRemoveContainer(name: string): void {
  try {
    if (containerRunning(name)) sh(`podman stop ${name}`);
    if (containerExists(name)) sh(`podman rm ${name}`);
  } catch {
    // best effort
  }
}

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

export function removeSidecars(service: Service): void {
  if (!service.container?.sidecars) return;
  for (const sc of service.container.sidecars) {
    removeSidecar(service.name, sc);
  }
}
