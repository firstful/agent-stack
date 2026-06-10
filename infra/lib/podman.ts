import { execSync } from "child_process";
import { resolveSecrets, interpolateSecrets, resolveEnvSecrets } from "./services";
import type { Service } from "./types";
import { CONTAINER_LABEL, NETWORK_NAME } from "./config";

// ── Basics ──

/**
 * Execute a shell command with inherited stdio.
 * @param cmd - command string
 * @param _ignore - unused, kept for compatibility
 */
export function sh(cmd: string, _ignore?: boolean): Buffer {
  return execSync(cmd, { stdio: "inherit" }) as unknown as Buffer;
}

/**
 * Execute a command and capture both stdout and stderr separately.
 * When the command fails (non-zero exit), stdout is empty and stderr
 * carries the error output.  Used where we need to inspect error details
 * rather than letting execSync throw.
 */
export function shWithStderr(cmd: string): { stdout: string; stderr: string } {
  try {
    const r = execSync(cmd, { stdio: ["inherit", "pipe", "pipe"] });
    return { stdout: r.toString().trim(), stderr: "" };
  } catch (e: any) {
    return { stdout: "", stderr: e.stderr?.toString()?.trim() || e.message };
  }
}

/**
 * Capture stdout of a command, trimmed.
 */
export function shCapture(cmd: string): string {
  return execSync(cmd).toString().trim();
}

// ── Image Ops ──

/**
 * Build a fully qualified image tag for a named service.
 * Format: stack/<name>:latest
 */
export function imageTag(name: string): string {
  return `stack/${name}:latest`;
}

/**
 * Return the podman label used to identify stack-managed containers.
 * All containers created by agent-stack get this label so we can
 * filter and manage them collectively.
 * @returns The label string used in --filter label=... queries
 */
export function containerLabel(): string {
  return CONTAINER_LABEL;
}

/**
 * Check whether a tagged image already exists in local podman storage.
 */
export function imageExists(name: string): boolean {
  try {
    execSync(`podman image exists ${imageTag(name)}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Container Ops ──

/**
 * Check whether a named container exists (in any state).
 */
export function containerExists(name: string): boolean {
  try {
    execSync(`podman inspect ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a named container is currently running.
 */
export function containerRunning(name: string): boolean {
  try {
    const out = shCapture(`podman ps --format "{{.Names}}"`);
    return out.split("\n").includes(name);
  } catch {
    return false;
  }
}

/**
 * List all managed containers (labelled with stack-managed=true).
 */
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

/**
 * Build a podman image for a service from its repo directory.
 * Applies build config (network, cache, extra podman args) and labels
 * the image with stack.commit=<hash> for traceability when available.
 * Throws on build failure — caller (reconcile.ts) handles backoff.
 */
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

/**
 * Get the host-side port a container is publishing.
 */
export function getContainerPort(name: string): number | null {
  try {
    const out = shCapture(`podman port ${name}`);
    const match = out.match(/:(\d+)$/m);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Poll a container until its health check passes or the timeout expires.
 * @returns true if healthy, false if container stopped or timed out
 */
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

/**
 * Collect the set of host ports currently bound by podman containers.
 */
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

// ── Network ──

/**
 * Create the shared podman network if it does not already exist.
 */
export function ensureNetwork(): void {
  try {
    sh(`podman network create ${NETWORK_NAME}`);
    console.log(`[network] created ${NETWORK_NAME}`);
  } catch {
    // network already exists
  }
}

// ── Service Discovery ──

/**
 * Build -e CONTAINERS_* environment variables for all services
 * so containers can discover each other by name.
 */
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

// ── Run Containers ──

/**
 * Options for runContainer.
 */
export interface RunContainerOptions {
  containerName?: string;
  hostPort?: number;
}

/**
 * Start a podman container for a service with discovery, secrets, and networking.
 */
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

  // Resolve vault secrets: auto-discover from {SECRETS.KEY} patterns in env,
  // falling back to the explicit secrets array for backward compatibility
  const resolvedSecrets = resolveEnvSecrets(service.name, containerEnv, service.secrets);
  // Interpolate vault secrets into env var values (replaces {SECRETS.KEY} patterns)
  const interpolated = interpolateSecrets(containerEnv, resolvedSecrets);
  const allEnv: Record<string, string> = { ...interpolated, ...resolvedSecrets };
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
