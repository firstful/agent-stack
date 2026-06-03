// Shared types for agent-stack infrastructure.

/** Configuration for a single sidecar container attached to a service. */
export interface SidecarConfig {
  name: string;
  image: string;
  port?: number;
  env?: Record<string, string>;
  volumes?: string[];
  command?: string[];
}

/** Health check probe configuration for container slot swaps. */
export interface HealthCheckConfig {
  path?: string;
  timeout?: number;
}

/** Container runtime configuration for a service. */
export interface ContainerConfig {
  port: number;
  auto_port?: boolean;
  host_port?: number;
  env?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  healthCheck?: HealthCheckConfig;
  sidecars?: SidecarConfig[];
}

/** systemd service unit configuration for non-container services. */
export interface SystemdServiceConfig {
  type: string;
  exec_start: string;
  exec_reload?: string;
  port: number;
  user?: string;
  restart?: string;
  env?: Record<string, string>;
}

/** Cloudflare Tunnel exposure configuration. */
export interface ExposeConfig {
  enabled: boolean;
  hostname?: string;
  /** Additional hostnames (including wildcards like *.engramic.ffilt.us)
   *  for profile-scoped or multi-domain routing.  The slot-proxy checks
   *  these alongside the primary hostname. */
  hostnames?: string[];
  tunnel?: string;
  no_proxy?: boolean;
}

/** Logo configuration — either a file relative to the service repo or an absolute URL. */
export interface LogoConfig {
  _type: "file" | "url";
  /** For _type="file": path relative to the service's repo root. */
  fileName?: string;
  /** For _type="file": join fileName with the repo path to resolve. Default true. */
  isRelative?: boolean;
  /** For _type="url": absolute URL to the logo image. */
  url?: string;
}

/** Container image build configuration. */
export interface BuildConfig {
  network?: string;
  no_cache?: boolean;
  podman_args?: string;
}

/**
 * Complete service definition as loaded from agent-stack.json or desired/*.json.
 * Internal fields (prefixed with _) are set by the services.ts loader.
 */
export interface Service {
  name: string;
  repo: string | null;
  version?: number;
  container: ContainerConfig | null;
  service: SystemdServiceConfig | null;
  expose: ExposeConfig | null;
  secrets?: string[];
  build?: BuildConfig;
  privileged?: boolean;
  /** Logo configuration — file from repo or absolute URL. */
  logo?: LogoConfig;
  // Internal fields (set by services.ts loader)
  _file: string;
  _fromRepo: boolean;
  _hash: string;
  _commitHash?: string;
}
