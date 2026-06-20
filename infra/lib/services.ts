import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import type { Service } from "./types";
import { DESIRED_DIR, REPOS_DIR, CLONES_DIR, INFRA_DIR, RUNTIME_FILE } from "./config";

// ── .stackignore ───────────────────────────────────────────────────────

/**
 * Parse a gitignore-style pattern file into an array of patterns.
 * Returns { patterns, negations } where each is an array of compiled pattern strings.
 */
function parseStackignore(content: string): { patterns: RegExp[]; negations: RegExp[] } {
  const patterns: RegExp[] = [];
  const negations: RegExp[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Strip trailing comment (after space+#)
    const commentIdx = line.indexOf(" #");
    const cleanLine = commentIdx >= 0 ? line.slice(0, commentIdx).trim() : line;
    if (!cleanLine) continue;

    const isNegation = cleanLine.startsWith("!");
    const pattern = isNegation ? cleanLine.slice(1).trim() : cleanLine;
    if (!pattern) continue;

    // Convert gitignore glob to regex
    const regex = globToRegex(pattern);
    if (isNegation) {
      negations.push(regex);
    } else {
      patterns.push(regex);
    }
  }

  return { patterns, negations };
}

/**
 * Convert a gitignore-style glob to a RegExp.
 * Supports: *, **, ?, [...], leading / (anchor to root), trailing / (dirs only)
 */
function globToRegex(glob: string): RegExp {
  let source = "";

  // Anchored at root if starts with /
  const anchored = glob.startsWith("/");
  let g = anchored ? glob.slice(1) : glob;

  // Trailing / means match directories only
  const dirOnly = g.endsWith("/");
  if (dirOnly) g = g.slice(0, -1);

  // Split on /
  const parts = g.split("/");
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];

    if (part === "**") {
      // ** matches zero or more directories
      source += "(?:.+/)?";
      i++;
      // If ** is the last part, it matches everything inside
      if (i >= parts.length) {
        source += ".*";
      }
      continue;
    }

    // Convert the glob part to regex
    const re = convertGlobPart(part);
    if (!anchored && i === 0) {
      // Not anchored: match anywhere (but start matching at path separators)
      source += `(?:${re}(?:/|$))`;
    } else if (i < parts.length - 1) {
      source += `${re}/`;
    } else {
      source += re;
    }
    i++;
  }

  if (dirOnly) {
    source += "(?:/.*)?";
  }

  // If not anchored, allow matching anywhere in path
  if (!anchored) {
    source = `(?:^|/)${source}$`;
  } else {
    source = `^${source}$`;
  }

  return new RegExp(source);
}

function convertGlobPart(part: string): string {
  let result = "";
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch === "*") {
      result += "[^/]*";
    } else if (ch === "?") {
      result += "[^/]";
    } else if (ch === "[" && i + 1 < part.length) {
      // Character class [...]
      const close = part.indexOf("]", i + 1);
      if (close >= 0) {
        result += part.slice(i, close + 1);
        i = close;
      } else {
        result += "\\" + ch;
      }
    } else {
      result += "\\" + ch;
    }
  }
  return result;
}

/**
 * Check if a file path relative to the repo root should be ignored.
 * Returns true if the file matches any ignore pattern (and is not negated).
 */
function isIgnored(relativePath: string, patterns: RegExp[], negations: RegExp[]): boolean {
  // Negations take priority: if explicitly un-ignored, it's not ignored
  for (const neg of negations) {
    if (neg.test(relativePath)) return false;
  }
  for (const pat of patterns) {
    if (pat.test(relativePath)) return true;
  }
  return false;
}

/**
 * Load .stackignore from a repo directory and return parsed patterns,
 * or null if no .stackignore exists.
 *
 * The .stackignore file uses gitignore-style glob patterns to exclude
 * files from the content hash, so trivial changes (docs, config metadata)
 * don't trigger container rebuilds.
 */
function loadStackignore(repoPath: string): { patterns: RegExp[]; negations: RegExp[] } | null {
  const ignorePath = path.join(repoPath, ".stackignore");
  try {
    const content = fs.readFileSync(ignorePath, "utf-8");
    return parseStackignore(content);
  } catch {
    return null;
  }
}

// ── Secrets ──

/**
 * Discover the vault service URL from runtime state or fallback.
 * Reads runtime/services.json to find the vault port, then checks the
 * VAULT_URL env var.  Falls back to localhost:4000 if neither is available.
 */
function discoverVaultUrl(): string {
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, "utf-8");
    const runtime = JSON.parse(raw);
    const port = runtime.vault?.port;
    if (port) return `http://localhost:${port}`;
  } catch {}
  if (process.env.VAULT_URL) return process.env.VAULT_URL;
  return "http://localhost:4000";
}

/**
 * Fetch secrets for a service by name, filtering to the requested keys.
 * Called by resolveSecrets (main container) and ensureSidecar (sidecars).
 * Throws if vault is unreachable or a requested key is missing.
 */
export function fetchSecrets(serviceName: string, keys: string[]): Record<string, string> {
  if (keys.length === 0) return {};
  if (!process.env.VAULT_TOKEN) {
    throw new Error(`[secrets] cannot resolve secrets for "${serviceName}": VAULT_TOKEN is not set`);
  }
  const vaultUrl = discoverVaultUrl();
  try {
    const curl = `curl -sf ${vaultUrl}/api/secrets/plain/${serviceName} -H "Authorization: Bearer ${process.env.VAULT_TOKEN}"`;
    const raw = execSync(curl, { timeout: 5000, encoding: "utf8" });
    const result = JSON.parse(raw);
    if (!result.secrets) {
      throw new Error(`[secrets] vault returned no secrets object for "${serviceName}"`);
    }
    const missing: string[] = [];
    const filtered: Record<string, string> = {};
    for (const key of keys) {
      if (result.secrets[key] !== undefined) filtered[key] = result.secrets[key];
      else missing.push(key);
    }
    if (missing.length > 0) {
      throw new Error(`[secrets] vault missing keys for "${serviceName}": ${missing.join(", ")}`);
    }
    return filtered;
  } catch (e: any) {
    if (e.message?.startsWith("[secrets]")) throw e;
    throw new Error(`[secrets] vault unreachable at ${vaultUrl} for "${serviceName}": ${e.message}`);
  }
}

/**
 * Discover which vault secrets an env block references.
 * Scans all env var values for `{SECRETS.KEY}` patterns and returns
 * the unique set of secret keys needed, in declaration order.
 *
 * @example
 *   env: { "URL": "http://{SECRETS.USER}:***@{SECRETS.HOST}/" }
 *   Returns: ["USER", "HOST"]
 */
export function discoverRequiredSecrets(env: Record<string, string>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const pattern = /\{SECRETS\.(\w+)\}/g;
  for (const value of Object.values(env)) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

/**
 * Interpolate vault secret values into env var values.
 * Replaces `{SECRETS.KEY}` patterns with the corresponding resolved secret value.
 * Referenced keys that aren't in resolvedSecrets are left as-is (with a warning).
 *
 * @example
 *   env: { "DATABASE_URL": "postgresql://fuselocal:***@fuse--db:5432/fuse" }
 *   resolvedSecrets: { "POSTGRES_PASSWORD": "fuselocalpw" }
 *   Result: { "DATABASE_URL": "postgresql://fuselocal:***@fuse--db:5432/fuse" }
 */
export function interpolateSecrets(
  env: Record<string, string>,
  resolvedSecrets: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /\{SECRETS\.(\w+)\}/g;
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(pattern, (match, refKey) => {
      if (resolvedSecrets[refKey] !== undefined) {
        return resolvedSecrets[refKey];
      }
      console.warn(`[secrets] env var "${key}" references secret "${refKey}" but it was not resolved — leaving placeholder`);
      return match;
    });
  }
  return result;
}

/**
 * Resolve vault secrets declared in the service's `secrets` array.
 * Used for backward compatibility — new configs should use `{SECRETS.KEY}`
 * interpolation in env vars instead.
 */
export function resolveSecrets(service: Service): Record<string, string> {
  if (!service.secrets || !Array.isArray(service.secrets) || service.secrets.length === 0) return {};
  return fetchSecrets(service.name, service.secrets);
}

/**
 * Resolve vault secrets needed by a service's env block.
 * Auto-discovers required keys from `{SECRETS.KEY}` patterns in env values.
 * Falls back to the explicit `secrets` array if no interpolation patterns found.
 */
export function resolveEnvSecrets(
  serviceName: string,
  env: Record<string, string>,
  declaredSecrets?: string[]
): Record<string, string> {
  const interpolatedKeys = discoverRequiredSecrets(env);
  const keys = interpolatedKeys.length > 0 ? interpolatedKeys : (declaredSecrets || []);
  if (keys.length === 0) return {};
  return fetchSecrets(serviceName, keys);
}

// ── Hashing ──

/**
 * Recursively MD5-hash a directory tree, optionally excluding files
 * matching a .stackignore pattern set.
 */
export function hashDir(dir: string, ignore?: { patterns: RegExp[]; negations: RegExp[] } | null): string {
  try {
    const hash = crypto.createHash("md5");
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".stackignore") continue;
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = entry.name;

      try {
        if (entry.isDirectory()) {
          // Check if the directory itself is ignored
          if (ignore && isIgnored(relPath + "/", ignore.patterns, ignore.negations)) continue;
          const subHash = hashDir(fullPath, ignore);
          if (subHash) {
            hash.update(relPath);
            hash.update(subHash);
          }
        } else {
          if (ignore && isIgnored(relPath, ignore.patterns, ignore.negations)) continue;
          hash.update(fs.readFileSync(fullPath));
        }
      } catch {
        // skip unreadable files/symlinks
      }
    }
    return hash.digest("hex");
  } catch {
    return "";
  }
}

const MONOREPO_ROOT = path.resolve(REPOS_DIR, "..");
const MONOREPO_GIT = path.join(MONOREPO_ROOT, ".git");

/**
 * Compute the git commit hash for a service repo path (fast trigger).
 *
 * Returns the most recent commit hash affecting this repo path, so the
 * controller can quickly detect if *anything* changed.  Falls back to
 * a full content hash when no git history is available.
 */
export function repoHashForPath(repoPath: string): string {
  if (fs.existsSync(MONOREPO_GIT)) {
    try {
      const relPath = path.relative(MONOREPO_ROOT, repoPath);
      const hash = execSync(`git log -1 --format=%H -- "${relPath}"`, {
        cwd: MONOREPO_ROOT,
        encoding: "utf-8",
        timeout: 5000,
      }).toString().trim();
      if (hash) return hash;
    } catch {
      // fall through to fs-based hash
    }
  }
  return hashDir(repoPath);
}

/**
 * Compute a .stackignore-aware content hash for a service repo.
 *
 * When .stackignore exists, files matching its patterns are excluded
 * from the hash so trivial changes (docs, config, metadata) don't
 * trigger container rebuilds.
 *
 * When no .stackignore exists, the full directory tree is hashed.
 */
export function repoContentHashForPath(repoPath: string): string {
  const ignore = loadStackignore(repoPath);
  return hashDir(repoPath, ignore);
}

// ── Git Cloning ──

/**
 * Detect if a repo path is a git submodule (not a full git checkout).
 * Submodules have a `.git` *file* (containing "gitdir: ...") instead of a `.git` *directory*.
 */
function isSubmodule(repoPath: string): boolean {
  const dotGit = path.join(repoPath, ".git");
  try {
    return fs.statSync(dotGit).isFile();
  } catch {
    return false;
  }
}

/**
 * Get the origin URL for a submodule from its working checkout.
 * Uses the already-configured remote URL (which carries the access token
 * from the initial clone) rather than the clean URL from .gitmodules.
 */
function submoduleUrl(submoduleName: string, repoPath: string): string | null {
  try {
    return execSync(`git remote get-url origin`, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 5000,
    }).toString().trim();
  } catch {
    return null;
  }
}

export function ensureServiceClone(service: Service): string | null {
  const repoPath = service.repo;
  if (!repoPath) return null;

  if (!repoPath.startsWith(REPOS_DIR)) return null;
  if (!fs.existsSync(MONOREPO_GIT)) return null;

  try {
    const relPath = path.relative(MONOREPO_ROOT, repoPath);
    const commitHash = execSync(`git log -1 --format=%H -- "${relPath}"`, {
      cwd: MONOREPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    }).toString().trim();

    if (!commitHash) return null;

    service._commitHash = commitHash;
    const cloneDir = path.join(CLONES_DIR, service.name, commitHash);

    if (!fs.existsSync(cloneDir)) {
      fs.mkdirSync(cloneDir, { recursive: true });

      if (isSubmodule(repoPath)) {
        // ── Submodule clone path ──
        // `git archive` doesn't expand submodules, so we clone directly
        // from the submodule's origin at the exact commit recorded in HEAD.
        const submoduleName = `repos/${service.name}`;
        const url = submoduleUrl(submoduleName, repoPath);
        if (!url) throw new Error(`Cannot find submodule URL for "${submoduleName}"`);

        const subCommit = execSync(`git rev-parse HEAD`, {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 5000,
        }).toString().trim();

        console.log(`[clone] ${service.name}: submodule from ${url} @ ${subCommit}`);
        execSync(
          `git clone --depth 1 "${url}" "${cloneDir}" 2>&1 && git -C "${cloneDir}" fetch --depth 1 origin "${subCommit}" && git -C "${cloneDir}" checkout "${subCommit}"`,
          { timeout: 60000 }
        );
      } else {
        // ── Monorepo archive path (existing logic) ──
        execSync(
          `git -C ${MONOREPO_ROOT} archive ${commitHash} -- "${relPath}/" | tar -x -C ${cloneDir} --strip-components=2`,
          { timeout: 30000 }
        );
      }
    }

    // Prune old clones — keep only the 4 most recent based on mtime
    const parentDir = path.join(CLONES_DIR, service.name);
    if (fs.existsSync(parentDir)) {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => ({
          name: e.name,
          mtime: fs.statSync(path.join(parentDir, e.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of entries.slice(4)) {
        const oldDir = path.join(parentDir, entry.name);
        fs.rmSync(oldDir, { recursive: true, force: true });
        console.log(`[services] pruned old clone: ${oldDir}`);
      }
    }

    return cloneDir;
  } catch (e: any) {
    console.error(`[services] failed to create clone for ${service.name}: ${e.message}`);
    return null;
  }
}

// ── Service Loading ──

/**
 * Scan all repo directories for agent-stack*.json config files.
 * Each repo may contain one or more service definitions:
 *   - agent-stack.json          → primary service (backwards compatible)
 *   - agent-stack.<variant>.json → additional services sharing the same repo
 *
 * For each config found, sets internal metadata (_file, _fromRepo, _hash, repo).
 * Repo-based services take precedence over desired/*.json entries with the same name.
 * @returns Array of parsed and hydrated Service objects
 */
function scanRepoAgentConfigs(): Service[] {
  const results: Service[] = [];
  let repos: fs.Dirent[];
  try {
    repos = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of repos) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const repoDir = path.join(REPOS_DIR, entry.name);

    // Scan all agent-stack*.json files in the repo directory.
    // Convention:
    //   agent-stack.json          → primary service (backwards compatible)
    //   agent-stack.<variant>.json → additional services sharing the same repo
    let configFiles: string[];
    try {
      configFiles = fs.readdirSync(repoDir)
        .filter(f => f.startsWith("agent-stack") && f.endsWith(".json"));
    } catch {
      continue;
    }
    if (configFiles.length === 0) continue;

    for (const configFile of configFiles) {
      const agentPath = path.join(repoDir, configFile);
      try {
        const raw = fs.readFileSync(agentPath, "utf-8");
        const service = JSON.parse(raw) as Service;
        if (!service.name) {
          console.error(`[services] ${agentPath} has no "name" field — skipping`);
          continue;
        }
        // Set internal metadata: repo path, source tracking, and content hash
        service.repo = repoDir;
        service._file = configFile;
        service._fromRepo = true;
        // Compute hash from the repo's git history (or filesystem fallback)
        service._hash = repoHashForPath(repoDir);
        results.push(service);
      } catch (e: any) {
        console.error(`[services] failed to load ${agentPath}: ${e.message} — skipping`);
      }
    }
  }
  return results;
}

/**
 * Load the desired set of services from repo agent-stack.json files
 * and desired/*.json.  Repo-based services take precedence.
 */
export function loadDesired(): Service[] {
  const services: Service[] = [];
  const nameIndex: Record<string, Service> = {};

  const repoServices = scanRepoAgentConfigs();
  for (const svc of repoServices) {
    nameIndex[svc.name] = svc;
    services.push(svc);
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(DESIRED_DIR).filter((f) => f.endsWith(".json"));
  } catch {}

  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DESIRED_DIR, f), "utf-8");
      const service = JSON.parse(raw) as Service;

      if (!service.name) {
        console.error(`[services] ${f} has no "name" field — skipping`);
        continue;
      }
      if (nameIndex[service.name]) {
        console.error(`[services] ${f} skipped — ${service.name} already defined by repo agent-stack.json`);
        continue;
      }

      service._file = f;
      service._fromRepo = false;
      service._hash = "";

      nameIndex[service.name] = service;
      services.push(service);
    } catch (e: any) {
      console.error(`[services] failed to load ${f}: ${e.message} — skipping`);
    }
  }
  return services;
}
