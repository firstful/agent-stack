import path from "path";

// Root paths for agent-stack infrastructure (env-overridable for testing)
export const DESIRED_DIR = process.env.STACK_DESIRED_DIR || "/srv/agent-stack/desired";
export const REPOS_DIR = process.env.STACK_REPOS_DIR || "/srv/agent-stack/repos";
export const RUNTIME_DIR = process.env.STACK_RUNTIME_DIR || "/srv/agent-stack/runtime";
export const CLONES_DIR = process.env.STACK_CLONES_DIR || "/srv/clones";
export const RUNTIME_FILE = path.join(RUNTIME_DIR, "services.json");
export const INFRA_DIR = path.resolve(__dirname, "..");

// Server configuration
export const MCP_PORT = parseInt(process.env.MCP_PORT || "80", 10);
export const SOCKET_PATH = process.env.STACK_SOCKET_PATH || "/tmp/agent-stack.sock";
export const LOG_FILE = path.join(__dirname, "..", "controller.log");

// Podman network
export const NETWORK_NAME = "stack-net";
export const CONTAINER_LABEL = "stack-managed=true";

// Cloudflare Tunnel
export const CLOUDFLARED_CONFIG = "/etc/cloudflared/config.yml";
export const RESTART_COOLDOWN = 30_000;

// Auto-port allocation range
export const AUTO_PORT_START = parseInt(process.env.AUTO_PORT_START || "4000", 10);
export const AUTO_PORT_END = parseInt(process.env.AUTO_PORT_END || "4999", 10);

// Systemd unit prefix
export const SYSTEMD_UNIT_PREFIX = "agent-stack-";

// Container hash marker
export function hashMarker(name: string): string {
  return `/tmp/stack.${name}.hash`;
}

// Slot marker — tracks active slot across reconciler restarts
export function slotMarker(name: string): string {
  return `/tmp/stack.${name}.slot`;
}
export const SLOTS = ["a", "b"] as const;
export type Slot = (typeof SLOTS)[number];
export function slotContainerName(base: string, slot: string): string {
  return `${base}--${slot}`;
}
export function oppositeSlot(slot: string): string {
  return slot === "a" ? "b" : "a";
}

export function slotOf(containerName: string): string | null {
  const m = containerName.match(/--([ab])$/);
  return m ? m[1] : null;
}

export function sidecarContainerName(serviceName: string, sidecarName: string): string {
  return `${serviceName}--${sidecarName}`;
}

export function isSidecar(containerName: string): boolean {
  return containerName.includes("--") && !/--[ab]$/.test(containerName);
}

export function baseServiceName(containerName: string): string | null {
  const idx = containerName.lastIndexOf("--");
  if (idx === -1) return null;
  const base = containerName.slice(0, idx);
  return base || null;
}

// Health check timeout for slot swaps
export const HEALTH_CHECK_TIMEOUT = 30_000;

// Password files (lazy-loaded)
export const SUDO_PASSWORD_FILE = path.join(__dirname, "..", ".sudo-password.txt");
export const ADMIN_PASSWORD_FILE = path.join(__dirname, "..", ".password.txt");

// Request limits
export const MAX_BODY_SIZE = 1_048_576; // 1 MB
export const REQUEST_TIMEOUT = 30_000;  // 30 seconds
