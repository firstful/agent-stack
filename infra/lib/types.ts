// Shared types for agent-stack infrastructure.

export interface SidecarConfig {
  name: string;
  image: string;
  port?: number;
  env?: Record<string, string>;
  volumes?: string[];
  command?: string[];
}

export interface ContainerConfig {
  port: number;
  auto_port?: boolean;
  host_port?: number;
  env?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  sidecars?: SidecarConfig[];
}

export interface SystemdServiceConfig {
  type: string;
  exec_start: string;
  exec_reload?: string;
  port: number;
  user?: string;
  restart?: string;
  env?: Record<string, string>;
}

export interface ExposeConfig {
  enabled: boolean;
  hostname?: string;
  tunnel?: string;
  no_proxy?: boolean;
}

export interface BuildConfig {
  network?: string;
  no_cache?: boolean;
  podman_args?: string;
}

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
