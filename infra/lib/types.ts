// Shared types for agent-stack infrastructure.

/** Configuration for a single sidecar container attached to a service. */
export interface SidecarConfig {
  name: string;
  image: string;
  port?: number;
  env?: Record<string, string>;
  secrets?: string[];
  volumes?: string[];
  command?: string[];
  /**
   * When true, declares this sidecar is safe to share between the active slot
   * and a canary slot under weighted traffic.  Canary deployments will be
   * skipped (falling back to immediate slot swap) if any sidecar is not
   * explicitly marked canary-safe, because the canary and active slots would
   * share mutable state (database, cache) and a rollback would be impossible.
   *
   * Default: false.  Set to true only for read-replicas, cache-only Redis,
   * search indexes, or other sidecars where concurrent access from two app
   * versions causes no side effects.
   *
   * @example
   * ```json
   * { "name": "redis", "image": "redis:7-alpine", "canarySafe": true }
   * ```
   */
  canarySafe?: boolean;
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

/** Per-service rate limiting configuration applied at the slot-proxy. */
export interface RateLimitConfig {
  /** Max requests per minute from a single IP. */
  requestsPerMinute: number;
  /** How long (ms) to block after exceeding the limit. Default: 600000 (10 min). */
  blockDurationMs?: number;
}

/**
 * Canary deploy configuration.
 *
 * After building a new image on the idle slot, the controller adds a `canary`
 * field to the runtime state (services.json).  The slot-proxy detects this and
 * routes a weighted fraction of **live traffic** to the canary slot while
 * counting HTTP 5xx responses.  If the error count stays below `maxErrorCount`
 * for `observationPeriodMs`, the canary is promoted to active (100% traffic).
 * If errors exceed the threshold, the canary is rolled back and removed.
 *
 * @example
 * ```json
 * "canary": {
 *   "observationPeriodMs": 300000,
 *   "maxErrorCount": 5,
 *   "weight": 0.1
 * }
 * ```
 */
export interface CanaryConfig {
  /** Observation window in milliseconds before promoting the canary (default: 300000 / 5 min). */
  observationPeriodMs: number;
  /** Maximum cumulative 5xx HTTP responses tolerated during the canary window. */
  maxErrorCount?: number;
  /**
   * Fraction of live traffic routed to the canary slot (0.0 – 1.0).
   * Default: 0.1 (10%).  Example: 0.25 = 25%.
   */
  weight?: number;
}

/** Deploy strategy — how the controller handles container updates on content change. */
export type DeployStrategy = "blue-green" | "recreate";

/**
 * Extended strategy configuration.  When the `strategy` field on a service is
 * a plain string (backward compatible), it behaves as before.  When it's an
 * object, you get additional controls:
 *
 *   ```json
 *   "strategy": { "type": "blue-green", "queue": true, "canary": { "observationPeriodMs": 300000, "maxErrorCount": 5, "weight": 0.1 } }
 *   ```
 *
 * - `type` — the deploy strategy (default: "blue-green")
 * - `queue` — when true, commits are queued and processed one at a time per
 *   reconciliation cycle, so three rapid commits build linearly instead of
 *   triggering three concurrent rebuilds.  Each entry in the queue represents
 *   a pending rebuild of the *latest* code state; the queue simply paces builds.
 * - `canary` — when set, the slot-proxy routes `weight` of live traffic to the
 *   newly built slot and observes HTTP 5xx error rates before promoting.
 */
export interface StrategyConfig {
  type: DeployStrategy;
  queue?: boolean;
  canary?: CanaryConfig;
}

/** Extract the deploy strategy type, normalising string ↔ object forms. */
export function getStrategyType(
  strategy?: DeployStrategy | StrategyConfig,
): DeployStrategy {
  if (!strategy) return "blue-green";
  if (typeof strategy === "string") return strategy;
  return strategy.type;
}

/** Check whether the queue feature is enabled for a given strategy. */
export function isQueueEnabled(
  strategy?: DeployStrategy | StrategyConfig,
): boolean {
  if (!strategy) return false;
  if (typeof strategy === "string") return false;
  return strategy.queue === true;
}

/** Extract the canary config from a strategy, or null if not configured. */
export function getCanaryConfig(
  strategy?: DeployStrategy | StrategyConfig,
): CanaryConfig | null {
  if (!strategy || typeof strategy === "string") return null;
  return strategy.canary || null;
}

/**
 * Check whether a service is safe for canary deployment.
 *
 * A service is canary-safe when either:
 *   - It has no sidecars (no shared mutable state)
 *   - ALL sidecars are explicitly marked `canarySafe: true`
 *
 * If any sidecar is not marked canary-safe (or the field is absent), the
 * controller falls back to immediate slot promotion instead of running
 * a weighted canary, because both active and canary slots would share
 * that sidecar and a rollback would be impossible if the canary mutates it.
 */
export function isCanarySafe(service: Service): boolean {
  if (!service.container?.sidecars || service.container.sidecars.length === 0) {
    return true;
  }
  return service.container.sidecars.every((sc) => sc.canarySafe === true);
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
  /** Per-IP rate limiting, enforced by the slot-proxy. */
  rateLimit?: RateLimitConfig;
  /**
   * Deploy strategy (default: "blue-green").  Set "recreate" to skip slot swap.
   * For advanced configuration, use an object: `{ "type": "blue-green", "queue": true }`.
   */
  strategy?: DeployStrategy | StrategyConfig;
  /** Logo configuration — file from repo or absolute URL. */
  logo?: LogoConfig;
  // Internal fields (set by services.ts loader)
  _file: string;
  _fromRepo: boolean;
  _hash: string;
  _commitHash?: string;
}
