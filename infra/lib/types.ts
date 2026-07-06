/**
 * types.ts — Shared type definitions for the agent-stack infrastructure.
 *
 * Defines the core interfaces used across all infra modules: Service definitions,
 * container/sidecar configurations, deploy strategies (blue-green, recreate, canary),
 * rate-limiting, exposure (Cloudflare Tunnel), and build config.
 *
 * All types are consumed by the services loader (services.ts), the reconciler
 * (reconcile.ts), and the runtime state writer (runtime.ts).  Internal fields
 * prefixed with _ are set by the services loader and should not appear in
 * user-written agent-stack.json files.
 */

// ── Sidecar Configuration ──

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

// ── Container Configuration ──

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
  /** Override the podman network for this container (default: stack-net).
   *  Use "host" for --network host, or any podman network name. */
  network?: string;
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
   *  for profile-scoped or multi-domain routing.  The controller checks
   *  these alongside the primary hostname. */
  hostnames?: string[];
  tunnel?: string;
}

// ── Logo Configuration ──

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

/** Per-service rate limiting configuration applied by the controller (proxy role). */
export interface RateLimitConfig {
  /** Max requests per minute from a single IP. */
  requestsPerMinute: number;
  /** How long (ms) to block after exceeding the limit. Default: 600000 (10 min). */
  blockDurationMs?: number;
}

// ── Canary Configuration ──

/**
 * Canary deploy configuration.
 *
 * After building a new image on the idle slot, the controller adds a `canary`
 * field to the runtime state (services.json).  The controller detects this and
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

// ── Deploy Strategy ──

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
 * - `canary` — when set, the controller routes `weight` of live traffic to the
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

// ── Build Configuration ──

/** Container image build configuration. */
export interface BuildConfig {
  network?: string;
  no_cache?: boolean;
  podman_args?: string;
  /**
   * Relative path to the Containerfile/Dockerfile within the service's repo.
   * When absent, defaults to "Containerfile" (or Dockerfile, podman's default
   * resolution).  Useful when a single repo directory defines multiple services
   * via separate agent-stack*.json files, each building from a different
   * Containerfile variant.
   *
   * @example
   * ```json
   * "build": { "containerfile": "Containerfile.worker" }
   * ```
   */
  containerfile?: string;
}

/**
 * Path trigger configuration for change detection.
 * Replaces the v1–v3 whole-repo hash + .stackignore model with
 * per-resource glob-based change detection.
 */
export interface WatchConfig {
  include: string[];
  exclude?: string[];
}

/** A watch field can be a shorthand array (include-only) or a full object. */
export type Watch = string[] | WatchConfig;

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
  /** Per-IP rate limiting, enforced by the controller. */
  rateLimit?: RateLimitConfig;
  /**
   * Deploy strategy (default: "blue-green").  Set "recreate" to skip slot swap.
   * For advanced configuration, use an object: `{ "type": "blue-green", "queue": true }`.
   */
  strategy?: DeployStrategy | StrategyConfig;
  /** Logo configuration — file from repo or absolute URL. */
  logo?: LogoConfig;
  /**
   * APK build module definition.
   * When present, defines an APK build that will be auto-built when the
   * repo's content changes. The APK is served by the install.ffilt.us
   * service with version information.
   */
  apkBuild?: ApkBuildConfig;
  // Internal fields (set by services.ts loader)
  _file: string;
  _fromRepo: boolean;
  _hash: string;
  _commitHash?: string;
  /** v4 watch config — set by normalizeManifest() for v4 services. */
  _watch?: WatchConfig;
}

/** Configuration for an APK build module. */
export interface ApkBuildConfig {
  /**
   * Project package name (e.g., "com.ffilt.us.red-thread", "com.reedsutliff.talaria").
   * Used to derive the short app name, OTA manifest path, and APK filename.
   */
  packageName: string;

  /**
   * Build type — determines the build toolchain.
   * Currently only "kotlin" (Android/Gradle) is supported.
   * Future: "flutter", "react-native".
   * Default: "kotlin".
   */
  type?: string;

  /**
   * Path within the repo where the Gradle project lives, relative to repo root.
   * E.g. "android" if build.gradle.kts is at repo/android/.
   * Default: the service name (e.g. "talaria").
   */
  path?: string;

  /**
   * Gradle task to run.  Default: "assembleDebug".
   * For release builds: "assembleRelease" or "bundleRelease".
   */
  task?: string;

  /**
   * Build variant — affects the output APK path.
   * Gradle outputs to: app/build/outputs/apk/<buildType>/app-<buildType>.apk
   * Default: "debug".
   */
  buildType?: string;

  /**
   * Destination directory name under /srv/data/files/apk/.
   * E.g. "Talaria" -> APKs go to /srv/data/files/apk/Talaria/.
   * Default: derived from packageName's last segment with original casing.
   */
  destDir?: string;

  /**
   * Extra -P properties to pass to Gradle, on top of the auto-injected
   * cfAccessClientId, cfAccessClientSecret, versionCode, versionName, buildDate.
   */
  extraProps?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════
// v4 Schema Types — Flattened multi-unit manifest
// ═══════════════════════════════════════════════════════════════════════

/** Normalize a Watch (shorthand or full) into a WatchConfig. */
export function normalizeWatch(w?: Watch, fallback?: Watch): WatchConfig {
  if (!w) {
    if (fallback) return normalizeWatch(fallback);
    return { include: ["**"], exclude: [] };
  }
  if (Array.isArray(w)) return { include: w, exclude: [] };
  return w;
}

/** Per-unit exposure override — allows a unit to override or disable the top-level expose config. */
export interface ExposeOverride {
  /** Override hostname for this unit. Omit to inherit top-level. */
  hostname?: string;
  /** Override tunnel for this unit. null = inherit top-level. */
  tunnel?: string | null;
  /** Disable external exposure for this unit. */
  disabled?: boolean;
}

/**
 * Build configuration input for a v4 container unit.
 * Uses camelCase (v4 JSON convention). Normalized to snake_case BuildConfig
 * by normalizeBuild() during manifest processing.
 */
export interface BuildInput {
  network?: string;
  noCache?: boolean;
  podmanArgs?: string;
}

// ── Unit Interfaces ──

/** A container unit — builds from a Containerfile, runs as a podman container. */
export interface ContainerUnit {
  name: string;
  containerfile?: string;
  build?: BuildInput;
  port: number;
  autoPort?: boolean;
  hostPort?: number;
  env?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  podmanArgs?: string;
  network?: string;
  healthCheck?: HealthCheckConfig;
  /** Sidecar names referencing SidecarUnit.name entries in the same manifest. */
  sidecars?: string[];
  watch?: Watch;
  strategy?: StrategyConfig;
  rateLimit?: RateLimitConfig;
  expose?: ExposeOverride;
}

/** A systemd unit — runs as a host systemd service. */
export interface SystemdUnit {
  name: string;
  watch?: Watch;
  type?: string;
  execStart: string;
  execReload?: string;
  port: number;
  user?: string;
  restart?: string;
  env?: Record<string, string>;
  expose?: ExposeOverride;
}

/** A sidecar unit — an auxiliary container (db, redis, etc.) shared project-wide. */
export interface SidecarUnit {
  name: string;
  image: string;
  watch?: Watch;
  port?: number;
  env?: Record<string, string>;
  secrets?: string[];
  volumes?: string[];
  command?: string[];
  canarySafe?: boolean;
}

/** An APK build unit — compiled from Gradle/Kotlin projects in the repo. */
export interface ApkUnit {
  name: string;
  packageName: string;
  watch?: Watch;
  type?: string;
  path?: string;
  task?: string;
  buildType?: string;
  destDir?: string;
  extraProps?: Record<string, string>;
}

/**
 * v4 RepoManifest — the top-level schema for agent-stack.json version 4.
 *
 * A single manifest can define multiple containers, systemd services,
 * sidecars, and APK builds — all as peer arrays.  Top-level fields serve
 * as shared defaults that individual units can override.
 */
export interface RepoManifest {
  version: 4;
  name: string;
  containers?: ContainerUnit[];
  systemd?: SystemdUnit[];
  sidecars?: SidecarUnit[];
  apks?: ApkUnit[];
  watch?: Watch;
  strategy?: StrategyConfig;
  rateLimit?: RateLimitConfig;
  expose?: ExposeConfig;
  logo?: LogoConfig;
  secrets?: string[];
  privileged?: boolean;
}

// ── Normalization ──

/**
 * Normalize a v4 camelCase build config (from JSON) into the internal
 * snake_case BuildConfig that the rest of the controller expects.
 * Also merges containerfile from the container unit into the build config.
 */
function normalizeBuild(
  build: BuildInput | undefined,
  containerfile?: string,
): BuildConfig | undefined {
  if (!build && !containerfile) return undefined;
  const result: BuildConfig = {};
  if (build?.network !== undefined) result.network = build.network;
  if (build?.noCache !== undefined) result.no_cache = build.noCache;
  if (build?.podmanArgs !== undefined) result.podman_args = build.podmanArgs;
  if (containerfile) result.containerfile = containerfile;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Merge a unit-level expose override with the top-level expose config.
 * Returns null if exposure is disabled at either level.
 */
function mergeExpose(
  topLevel: RepoManifest["expose"],
  override?: ExposeOverride,
): ExposeConfig | null {
  if (override?.disabled === true) return null;
  if (!topLevel || topLevel.enabled === false) return null;
  return {
    enabled: true,
    hostname: override?.hostname ?? topLevel.hostname,
    hostnames: topLevel.hostnames,
    tunnel: override?.tunnel === null ? topLevel.tunnel : (override?.tunnel ?? topLevel.tunnel),
  };
}

/**
 * Convert a v4 RepoManifest into an array of Service objects
 * consumable by the existing controller pipeline.
 *
 * Handles:
 *   - Convenience naming (single-container repos collapse to project name)
 *   - Sidecar name resolution (string refs → SidecarConfig objects)
 *   - Default/override merging for strategy, rateLimit, expose, watch
 *   - APK units become containerless Services
 *   - Systemd units become containerless Services
 *   - Standalone sidecars become their own Services
 */
export function normalizeManifest(
  manifest: RepoManifest,
  repoPath: string,
): Service[] {
  const services: Service[] = [];

  // Build a sidecar index for name resolution
  const sidecarMap = new Map<string, SidecarUnit>();
  for (const sc of manifest.sidecars || []) {
    sidecarMap.set(sc.name, sc);
  }

  // Resolve sidecar references: string[] names → SidecarConfig[]
  function resolveSidecarConfigs(names: string[] | undefined): SidecarConfig[] {
    if (!names || names.length === 0) return [];
    return names.map((name) => {
      const sc = sidecarMap.get(name);
      if (!sc) throw new Error(`[manifest] sidecar "${name}" referenced but not defined in manifest`);
      return {
        name: sc.name,
        image: sc.image,
        port: sc.port,
        env: sc.env,
        secrets: sc.secrets,
        volumes: sc.volumes,
        command: sc.command,
        canarySafe: sc.canarySafe,
      };
    });
  }

  // Determine the convenience key for a container
  function containerServiceKey(c: ContainerUnit): string {
    const totalContainers = (manifest.containers || []).length;
    if (totalContainers === 1 && c.name === manifest.name) return manifest.name;
    return `${manifest.name}--${c.name}`;
  }

  // ── Normalize containers → Service[] ──
  for (const c of manifest.containers || []) {
    const serviceKey = containerServiceKey(c);
    const resolvedSidecars = resolveSidecarConfigs(c.sidecars);

    services.push({
      name: serviceKey,
      repo: repoPath,
      version: 4,
      container: {
        port: c.port,
        auto_port: c.autoPort,
        host_port: c.hostPort,
        env: c.env,
        volumes: c.volumes,
        command: c.command,
        healthCheck: c.healthCheck,
        sidecars: resolvedSidecars.length > 0 ? resolvedSidecars : undefined,
        network: c.network,
      },
      service: null,
      expose: mergeExpose(manifest.expose, c.expose),
      build: normalizeBuild(c.build, c.containerfile),
      strategy: c.strategy || manifest.strategy,
      rateLimit: c.rateLimit || manifest.rateLimit,
      logo: manifest.logo,
      secrets: manifest.secrets,
      privileged: manifest.privileged,
      _file: "agent-stack.json",
      _fromRepo: true,
      _hash: "", // set by caller (services.ts) after loading
      _watch: normalizeWatch(c.watch, manifest.watch),
    });
  }

  // ── Normalize systemd units → Service[] ──
  for (const sd of manifest.systemd || []) {
    services.push({
      name: `${manifest.name}--${sd.name}`,
      repo: repoPath,
      version: 4,
      container: null,
      service: {
        type: sd.type || "simple",
        exec_start: sd.execStart,
        exec_reload: sd.execReload,
        port: sd.port,
        user: sd.user || "root",
        restart: sd.restart || "always",
        env: sd.env,
      },
      expose: mergeExpose(manifest.expose, sd.expose),
      _file: "agent-stack.json",
      _fromRepo: true,
      _hash: "",
    });
  }

  // ── Normalize APK units → containerless Service[] ──
  for (const apk of manifest.apks || []) {
    services.push({
      name: `${manifest.name}--apk-${apk.name}`,
      repo: repoPath,
      version: 4,
      container: null,
      service: null,
      expose: null,
      apkBuild: {
        packageName: apk.packageName,
        type: apk.type,
        path: apk.path || apk.name,
        task: apk.task,
        buildType: apk.buildType,
        destDir: apk.destDir,
        extraProps: apk.extraProps,
      },
      _file: "agent-stack.json",
      _fromRepo: true,
      _hash: "",
    });
  }

  // ── Normalize standalone sidecars (not referenced by any container) → Service[] ──
  const referencedSidecars = new Set<string>();
  for (const c of manifest.containers || []) {
    for (const name of c.sidecars || []) {
      referencedSidecars.add(name);
    }
  }

  for (const sc of manifest.sidecars || []) {
    if (referencedSidecars.has(sc.name)) continue; // already inlined into a container

    // Standalone sidecar — wrap as a container Service with the sidecar as its only unit
    services.push({
      name: `${manifest.name}--${sc.name}`,
      repo: repoPath,
      version: 4,
      container: {
        port: sc.port || 0,
        sidecars: [{
          name: sc.name,
          image: sc.image,
          port: sc.port,
          env: sc.env,
          secrets: sc.secrets,
          volumes: sc.volumes,
          command: sc.command,
          canarySafe: sc.canarySafe,
        }],
      },
      service: null,
      expose: null,
      build: undefined,
      _file: "agent-stack.json",
      _fromRepo: true,
      _hash: "",
    });
  }

  return services;
}
