/**
 * config.ts — Paths, constants, naming helpers, and timeouts for agent-stack.
 *
 * Central configuration module consumed by all lib/ modules and controller.ts.
 * All paths are env-overridable for testing (STACK_* env vars).
 * Provides:
 *   - Filesystem paths (DESIRED_DIR, REPOS_DIR, RUNTIME_DIR, etc.)
 *   - Server/port configuration (MCP_PORT, SOCKET_PATH)
 *   - Podman network and label constants (NETWORK_NAME, CONTAINER_LABEL)
 *   - Cloudflare tunnel config and restart cooldown
 *   - Slot/sidecar container naming helpers
 *   - Marker file path helpers (hash, slot, queue, canary, commit)
 *   - Timeouts, secrets paths, and request limits
 */

import path from "path";

// ── Paths ──

// Root cache/data directory — all build artifacts (clones, APKs, package caches)
// live under this tree.  Override with CACHE_DATA_DIR env var.
export const CACHE_DATA_DIR = process.env.CACHE_DATA_DIR || "/srv/data";

// Root paths for agent-stack infrastructure (env-overridable for testing)
export const DESIRED_DIR = process.env.STACK_DESIRED_DIR || "/srv/agent-stack/desired";
export const REPOS_DIR = process.env.STACK_REPOS_DIR || "/srv/agent-stack/repos";
export const RUNTIME_DIR = process.env.STACK_RUNTIME_DIR || "/srv/agent-stack/runtime";
export const CLONES_DIR = process.env.STACK_CLONES_DIR || path.join(CACHE_DATA_DIR, "clones");
export const FILES_DIR = process.env.STACK_FILES_DIR || path.join(CACHE_DATA_DIR, "files");
export const RUNTIME_FILE = path.join(RUNTIME_DIR, "services.json");
export const INFRA_DIR = path.resolve(__dirname, "..");

// ── Server ──

// Server configuration
export const MCP_PORT = parseInt(process.env.MCP_PORT || "80", 10);
export const SOCKET_PATH = process.env.STACK_SOCKET_PATH || "/tmp/agent-stack.sock";
export const LOG_FILE = path.join(__dirname, "..", "controller.log");

// ── Podman ──

export const NETWORK_NAME = "stack-net";
export const CONTAINER_LABEL = "stack-managed=true";

// ── Cloudflare ──

export const CLOUDFLARED_CONFIG = "/etc/cloudflared/config.yml";
export const RESTART_COOLDOWN = 30_000;

// ── Port Range ──

export const AUTO_PORT_START = parseInt(process.env.AUTO_PORT_START || "4000", 10);
export const AUTO_PORT_END = parseInt(process.env.AUTO_PORT_END || "4999", 10);

// ── Systemd ──

export const SYSTEMD_UNIT_PREFIX = "agent-stack-";

// ── Slot Management ──

/**
 * Path to the queue marker file for a service.  The queue stores the
 * number of pending builds as an integer string.  When `strategy.queue`
 * is enabled, each commit increments the counter and the controller
 * processes one build per reconciliation cycle.
 */
export function queueMarker(name: string): string {
  return `/tmp/stack.${name}.queue`;
}

/**
 * Path to the hash marker file for a service.  The hash marker stores
 * the content hash of the last *built* image so the controller can
 * skip rebuilds when source hasn't changed.
 */
export function hashMarker(name: string): string {
  return `/tmp/stack.${name}.hash`;
}

/**
 * Path to the commit hash marker file for a service.  Stores the most
 * recent git commit hash processed, enabling the fast O(1) change
 * detection check in the reconciliation loop.
 */
export function commitHashMarker(name: string): string {
  return `/tmp/stack.${name}.chash`;
}

/**
 * Path to the APK build hash marker file for a service.  Stores the content
 * hash of the last *built* APK so the controller can skip rebuilds when
 * source hasn't changed.  Separate from the container hash marker because
 * APK builds have a different trigger scope (app source vs server).
 */
export function apkHashMarker(name: string): string {
  return `/tmp/stack.${name}.apk-hash`;
}

/**
 * Path to the slot marker file, which records which slot ("a" or "b")
 * is currently active for a service.
 */
export function slotMarker(name: string): string {
  return `/tmp/stack.${name}.slot`;
}

/**
 * Path to the canary marker file.  Stores JSON with the canary start time,
 * which slot is being observed, and the cumulative 5xx error count from the
 * controller (in its proxy role).  The controller writes the error metrics here; the controller
 * reads them to decide promotion or rollback.
 */
export function canaryMarker(name: string): string {
  return `/tmp/stack.${name}.canary`;
}

export const SLOTS = ["a", "b"] as const;
export type Slot = (typeof SLOTS)[number];

/** Build a slot-specific container name: <base>--a or <base>--b. */
export function slotContainerName(base: string, slot: string): string {
  return `${base}--${slot}`;
}

/** Return the opposite slot ("a" ↔ "b"). */
export function oppositeSlot(slot: string): string {
  return slot === "a" ? "b" : "a";
}

/** Extract the slot suffix ("a" or "b") from a slot container name, or null. */
export function slotOf(containerName: string): string | null {
  const m = containerName.match(/--([ab])$/);
  return m ? m[1] : null;
}

// ── Container Naming ──

/** Build a sidecar container name: <service>--<sidecar>. */
export function sidecarContainerName(serviceName: string, sidecarName: string): string {
  return `${serviceName}--${sidecarName}`;
}

/** Check if a container name belongs to a sidecar (has -- but not --a/--b). */
export function isSidecar(containerName: string): boolean {
  return containerName.includes("--") && !/--[ab]$/.test(containerName);
}

/** Derive the base service name from a slot or sidecar container name. */
export function baseServiceName(containerName: string): string | null {
  const idx = containerName.lastIndexOf("--");
  if (idx === -1) return null;
  const base = containerName.slice(0, idx);
  return base || null;
}

// ── Timeouts ──

export const HEALTH_CHECK_TIMEOUT = 60_000;

// ── Secrets ──

export const SUDO_PASSWORD_FILE = path.join(__dirname, "..", ".sudo-password.txt");
export const ADMIN_PASSWORD_FILE = path.join(__dirname, "..", ".password.txt");

// ── Request Limits ──

export const MAX_BODY_SIZE = 1_048_576; // 1 MB
export const REQUEST_TIMEOUT = 30_000;  // 30 seconds
