import { execSync } from "child_process";
import { resolveSecrets } from "./services";
import type { Service } from "./types";
import { CONTAINER_LABEL, NETWORK_NAME } from "./config";

export function sh(cmd: string, _ignore?: boolean): Buffer {
  return execSync(cmd, { stdio: "inherit" }) as unknown as Buffer;
}

export function shWithStderr(cmd: string): { stdout: string; stderr: string } {
  try {
    const r = execSync(cmd, { stdio: ["inherit", "pipe", "pipe"] });
    return { stdout: r.toString().trim(), stderr: "" };
  } catch (e: any) {
    return { stdout: "", stderr: e.stderr?.toString()?.trim() || e.message };
  }
}

export function shCapture(cmd: string): string {
  return execSync(cmd).toString().trim();
}

export function imageTag(name: string): string {
  return `stack/${name}:latest`;
}

export function containerLabel(): string {
  return CONTAINER_LABEL;
}

export function imageExists(name: string): boolean {
  try {
    execSync(`podman image exists ${imageTag(name)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function containerExists(name: string): boolean {
  try {
    execSync(`podman inspect ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function containerRunning(name: string): boolean {
  try {
    const out = shCapture(`podman ps --format "{{.Names}}"`);
    return out.split("\n").includes(name);
  } catch {
    return false;
  }
}

export function getManagedContainers(): string[] {
  try {
    const out = shCapture(
      `podman ps -a --filter label=${containerLabel()} --format "{{.Names}}"`
    );
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

export function buildImage(service: Service): void {
  console.log(`[build] ${imageTag(service.name)} from ${service.repo}`);
  const cfg = service.build || {};
  const net = cfg.network ? `--network ${cfg.network}` : "";
  const cache = cfg.no_cache ? "--no-cache" : "";
  const extra = cfg.podman_args || "";
  const commitLabel = service._commitHash
    ? `--label stack.commit=${service._commitHash}`
    : "";
  try {
    sh(
      `podman build ${net} ${cache} ${extra} ${commitLabel} --cpu-quota=200000 --cpu-period=100000 --memory 4g -t ${imageTag(service.name)} ${service.repo}`
    );
  } catch (e: any) {
    console.error(`[build] ${imageTag(service.name)} failed: ${e.message}`);
    throw e;
  }
}

export function getContainerPort(name: string): number | null {
  try {
    const out = shCapture(`podman port ${name}`);
    const match = out.match(/:(\d+)$/m);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

export function waitForHealthy(
  containerName: string,
  port: number,
  timeout: number,
  healthCheckPath?: string
): boolean {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!containerRunning(containerName)) return false;
    try {
      if (healthCheckPath) {
        shCapture(
          `curl -sf http://127.0.0.1:${port}${healthCheckPath} >/dev/null 2>&1`
        );
      } else {
        shCapture(`timeout 2 bash -c 'echo >/dev/tcp/127.0.0.1/${port}' 2>/dev/null`);
      }
      return true;
    } catch {
      // not ready yet
    }
  }
  return false;
}

export function getUsedHostPorts(): Set<number> {
  try {
    const out = shCapture(`podman ps -a --format "{{.Ports}}"`);
    const ports = new Set<number>();
    for (const line of out.split("\n")) {
      for (const m of line.matchAll(/(\d+)->/g)) {
        ports.add(parseInt(m[1], 10));
      }
    }
    return ports;
  } catch {
    return new Set();
  }
}

export function ensureNetwork(): void {
  try {
    sh(`podman network create ${NETWORK_NAME}`);
    console.log(`[network] created ${NETWORK_NAME}`);
  } catch {
    // network already exists
  }
}

export function buildDiscoveryEnv(allServices: Service[] | undefined): string {
  if (!allServices || allServices.length === 0) return "";
  const pairs: string[] = [];
  for (const s of allServices) {
    let port: number | null = null;
    let host: string | null = null;

    if (s.container?.port) {
      port = s.container.port;
      host = s.name;
    } else if (s.service?.port) {
      port = s.service.port;
      host = "host.containers.internal";
    }

    if (port && host) {
      const key = s.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      pairs.push(`-e CONTAINERS_${key}_HOST=${host}`);
      pairs.push(`-e CONTAINERS_${key}_PRIMARY_PORT=${port}`);
    }
  }
  return pairs.join(" ");
}

export interface RunContainerOptions {
  containerName?: string;
  hostPort?: number;
}

export function runContainer(
  service: Service,
  allServices: Service[],
  opts?: RunContainerOptions
): void {
  const name = opts?.containerName || service.name;
  const tag = imageTag(service.name);
  const port = service.container!.port;
  const hostPort = opts?.hostPort || service.container!.host_port || port;
  const vol = (service.container!.volumes || [])
    .map((v) => `-v ${v}`)
    .join(" ");

  const hostPath = process.env.PATH || "";
  const mappedPath = hostPath.split(":").map((p) => `/host${p}`).join(":");
  const containerDefaultPath =
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  const containerEnv = {
    ...(service.container!.env || {}),
    PATH: `${containerDefaultPath}:${mappedPath}`,
  };

  const resolvedSecrets = resolveSecrets(service);
  const allEnv: Record<string, string> = { ...containerEnv, ...resolvedSecrets };
  allEnv.IS_CONTAINER = "true";
  const env = Object.entries(allEnv)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  const discovery = buildDiscoveryEnv(allServices);
  const priv = service.privileged ? "--privileged" : "";
  const cmd = (service.container!.command || []).join(" ");

  ensureNetwork();

  try {
    const usedPorts = shCapture(`podman ps -a --format "{{.Ports}}"`)
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => [...line.matchAll(/(\d+)->/g)].map((m) => m[1]));
    if (allServices) {
      for (const s of allServices) {
        if (s.name === name) continue;
        if (s.container?.host_port) usedPorts.push(String(s.container.host_port));
      }
    }
    if (usedPorts.includes(String(hostPort))) {
      console.warn(`[warn] host port ${hostPort} already claimed by another container`);
    }
  } catch {
    // can't check ports
  }

  console.log(
    `[run] starting ${name} on host port ${hostPort} → container port ${port}`
  );
  try {
    const cmdline = `podman run -d --label ${containerLabel()} --name ${name} -p ${hostPort}:${port} --network ${NETWORK_NAME} --add-host host.containers.internal:host-gateway --add-host runtime:host-gateway --add-host agent-stack:host-gateway ${vol} ${discovery} ${env} ${priv} ${tag} ${cmd}`;
    const { stderr } = shWithStderr(cmdline);
    if (stderr) {
      console.error(`[run] ${name} stderr: ${stderr.slice(0, 500)}`);
      throw new Error(`podman run failed: ${stderr.slice(0, 500)}`);
    }
  } catch (e: any) {
    console.error(`[run] ${name} failed on host port ${hostPort}: ${e.message.slice(0, 300)}`);
    throw e;
  }
}
