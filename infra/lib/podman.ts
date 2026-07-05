/**
 * podman.ts — Podman CLI wrappers for the agent-stack controller.
 *
 * Provides a pure-function abstraction over the podman command line:
 *   - Build / inspect / tag images
 *   - Create, run, stop, remove containers
 *   - Manage the shared stack-net podman network
 *   - Discover peer services via injected env vars
 *   - Health-check containers after deployment
 *
 * All functions are synchronous and throw on podman failures
 * (callers like reconcile.ts handle retry/backoff).
 */

import { execSync } from "child_process";
import * as fs from "fs";
import path from "path";
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
 * Get the volume mount string for the mitmproxy CA bundle.
 * Creates a combined CA bundle (system + mitmproxy) if needed or stale.
 * Returns a podman -v argument, or empty string if mitmproxy is unavailable.
 * Shared by buildImage() (build time) and runContainer() (run time).
 *
 * Rationale: the host runs a transparent mitmproxy on port 8080 that
 * intercepts outbound HTTPS to inject Cloudflare Access headers.  Without
 * trusting the mitmproxy CA, containers see TLS cert warnings on every
 * HTTPS fetch.  This function merges the host's system CA bundle with the
 * mitmproxy CA into a single file and mounts it over the container's default
 * CA path so tools (curl, pip, npm, git) trust both CAs automatically.
 */
function getMitmCAVolumeMount(): string {
  const MITM_CA = "/var/lib/cfproxy/.mitmproxy/mitmproxy-ca-cert.pem";
  const HOST_CA = "/etc/ssl/certs/ca-certificates.crt";
  const COMBINED_CA = "/var/lib/cfproxy/combined-ca-bundle.crt";
  if (fs.existsSync(MITM_CA)) {
    try {
      const hostBundle = fs.readFileSync(HOST_CA, "utf-8");
      const mitmCert = fs.readFileSync(MITM_CA, "utf-8");
      const needsRebuild =
        !fs.existsSync(COMBINED_CA) ||
        fs.statSync(COMBINED_CA).mtimeMs < fs.statSync(MITM_CA).mtimeMs;
      if (needsRebuild) {
        const marker = mitmCert.trim().slice(0, 60);
        if (!hostBundle.includes(marker)) {
          fs.writeFileSync(COMBINED_CA, hostBundle + "\n" + mitmCert);
          console.log(`[ca-bundle] created ${COMBINED_CA} (mitmproxy CA injected)`);
        } else {
          // Cert already in host bundle — copy it to the combined path so the
          // volume mount target exists (prevents docker/podman errors from a
          // dangling mount to a non-existent file).
          fs.writeFileSync(COMBINED_CA, hostBundle);
          console.log(`[ca-bundle] created ${COMBINED_CA} (from host bundle, mitmproxy already trusted)`);
        }
      }
      return ` -v ${COMBINED_CA}:/etc/ssl/certs/ca-certificates.crt:ro`;
    } catch (e: any) {
      console.warn(`[ca-bundle] failed to create combined bundle: ${e.message}`);
    }
  }
  return "";
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
  // Tag the image with the git commit hash for traceability back to source
  const commitLabel = service._commitHash
    ? `--label stack.commit=${service._commitHash}`
    : "";
  const containerfile = cfg.containerfile
    ? `-f ${path.join(service.repo!, cfg.containerfile)}`
    : "";

  // Inject combined CA bundle so pip/npm/curl can verify TLS
  // through the host's mitmproxy during the build.
  const caVol = getMitmCAVolumeMount();
  // Node.js ignores the system CA store by default — it uses its own
  // built-in store.  NODE_EXTRA_CA_CERTS tells Node.js to also trust
  // the mitmproxy CA, which is required for npm ci and any other
  // Node.js HTTPS fetches during the build.  Harmless for non-Node.js
  // and persists to the final image (where it also helps at runtime).
  const nodeExtraCAs = `--env NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt`;

  try {
    // Resource limits: 4GB memory, 200ms CPU period quota (2 cores at 100%).
    // --cpu-quota=200000 --cpu-period=100000 means the container gets up to
    // 200ms of CPU time per 100ms period, i.e. 2 full cores.  These prevent
    // a single build from starving the host of memory or CPU during parallel
    // builds or under load.
    // podman's caching layer only rebuilds Dockerfile steps whose inputs changed.
    sh(
      `podman build ${containerfile} ${net} ${cache} ${extra} ${nodeExtraCAs} ${commitLabel} --cpu-quota=200000 --cpu-period=100000 --memory 4g -t ${imageTag(service.name)} ${service.repo}${caVol}`
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
 *
 * For each discovered service, injects TWO env vars:
 *   CONTAINERS_<NAME>_HOST=<hostname>      — the host to reach the service
 *   CONTAINERS_<NAME>_PRIMARY_PORT=<port>  — the port the service listens on
 *
 * Container services are reachable by their service name as DNS on stack-net.
 * Systemd services (no container block) are reachable via host.containers.internal.
 *
 * Env var names are sanitised: uppercase, non-alphanumeric characters become
 * underscores.  Example: "fuse-worker" → "FUSE_WORKER".
 */
export function buildDiscoveryEnv(allServices: Service[] | undefined): string {
  if (!allServices || allServices.length === 0) return "";
  const pairs: string[] = [];
  for (const s of allServices) {
    let port: number | null = null;
    let host: string | null = null;

    if (s.container?.port) {
      // Container service: reachable by its own name as DNS on stack-net
      port = s.container.port;
      host = s.name;
    } else if (s.service?.port) {
      // Systemd service: reachable via host.containers.internal gateway
      port = s.service.port;
      host = "host.containers.internal";
    }

    if (port && host) {
      // Sanitise service name for env var syntax: uppercase, non-alphanum → underscore
      // e.g. "fuse-worker" → "FUSE_WORKER"
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

  // ── Auto-inject mitmproxy CA cert ──────────────────────────
  // The host runs a transparent mitmproxy (cf-proxy) on port 8080
  // that intercepts all outbound HTTPS for CF-Access header injection.
  // Containers can't verify TLS certs without trusting the mitmproxy CA.
  // We create a combined CA bundle and mount it over the default path.
  const mitmVol = getMitmCAVolumeMount();

  // Map host PATH into container at /host<path> so tools like
  // curl and git are available even from minimal base images.
  // This is a pragmatic workaround: many service images ship without
  // basic debugging tools, and this gives containers access to the
  // host's full toolchain at /host/usr/bin/curl, /host/usr/bin/git, etc.
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
  // When the mitmproxy CA bundle is mounted, tell Python SSL libraries
  // (httpx, certifi, requests, huggingface_hub) to use it instead of
  // their bundled CA store, so the mitmproxy CA is trusted.
  if (mitmVol) {
    allEnv.SSL_CERT_FILE = "/etc/ssl/certs/ca-certificates.crt";
    // Node.js doesn't read the system CA store by default — needs
    // NODE_EXTRA_CA_CERTS so npm, node-fetch, axios, etc. all trust
    // the mitmproxy CA through the CF proxy.
    allEnv.NODE_EXTRA_CA_CERTS = "/etc/ssl/certs/ca-certificates.crt";
  }
  const env = Object.entries(allEnv)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  const discovery = buildDiscoveryEnv(allServices);
  const priv = service.privileged ? "--privileged" : "";
  const cmd = (service.container!.command || []).join(" ");

  ensureNetwork();

  // Warn if the requested host port is already claimed by another container
  // or by a peer service's configured host_port.  Not a hard error because
  // podman will fail the run itself if the port is truly in use.
  // This is best-effort detection: it covers running containers and config-
  // declared host_ports but cannot detect processes bound outside podman.
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
    // can't check ports — e.g. podman not installed yet
  }

  console.log(
    `[run] starting ${name} on host port ${hostPort} → container port ${port}`
  );
  try {
    // Full command line: detached mode, stack-managed label, port mapping, network,
    // host gateway entries, volumes, discovery env vars, vault secrets, and command.
    // Use service-level network override when set; --network host skips port mapping
    // and host-gateway adds (they don't apply to host networking).
    const netName = service.container?.network || NETWORK_NAME;
    const netFlag = netName === "host" ? "--network host" : `--network ${netName}`;
    const portFlag = netName === "host" ? "" : `-p ${hostPort}:${port}`;
    const gatewayFlags = netName === "host" ? "" : "--add-host host.containers.internal:host-gateway --add-host runtime:host-gateway --add-host agent-stack:host-gateway";
    const cmdline = `podman run -d --label ${containerLabel()} --name ${name} ${portFlag} ${netFlag} ${gatewayFlags} ${vol}${mitmVol} ${discovery} ${env} ${priv} ${tag} ${cmd}`;
    // Use shWithStderr so we capture podman's stderr for error diagnosis
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
