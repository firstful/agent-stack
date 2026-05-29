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
  tunnel?: string;
  no_proxy?: boolean;
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
  // Internal fields (set by services.ts loader)
  _file: string;
  _fromRepo: boolean;
  _hash: string;
  _commitHash?: string;
}
