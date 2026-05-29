import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import type { Service } from "./types";
import { DESIRED_DIR, REPOS_DIR, CLONES_DIR, INFRA_DIR, RUNTIME_FILE } from "./config";

// ── Secrets ──

function discoverVaultUrl(): string {
  // 1. Read vault's host port from the previous runtime state
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, "utf-8");
    const runtime = JSON.parse(raw);
    const port = runtime.vault?.port;
    if (port) return `http://localhost:${port}`;
  } catch {
    // runtime file not available yet
  }
  // 2. Fall back to env var (legacy)
  if (process.env.VAULT_URL) return process.env.VAULT_URL;
  // 3. Hardcoded fallback
  return "http://localhost:4000";
}

/**
 * Resolve secrets for a service from the vault, returning a flat env dict.
 * @throws if VAULT_TOKEN is missing or vault is unreachable
 */
export function resolveSecrets(service: Service): Record<string, string> {
  if (!service.secrets || !Array.isArray(service.secrets) || service.secrets.length === 0) return {};
  if (!process.env.VAULT_TOKEN) {
    throw new Error(`[secrets] cannot resolve secrets for "${service.name}": VAULT_TOKEN is not set`);
  }
  const vaultUrl = discoverVaultUrl();
  try {
    const curl = `curl -sf ${vaultUrl}/api/secrets/plain/${service.name} -H "Authorization: Bearer ${process.env.VAULT_TOKEN}"`;
    const raw = execSync(curl, { timeout: 5000, encoding: "utf8" });
    const result = JSON.parse(raw);
    if (!result.secrets) {
      throw new Error(`[secrets] vault returned no secrets object for "${service.name}"`);
    }
    const missing: string[] = [];
    const filtered: Record<string, string> = {};
    for (const key of service.secrets) {
      if (result.secrets[key] !== undefined) filtered[key] = result.secrets[key];
      else missing.push(key);
    }
    if (missing.length > 0) {
      throw new Error(`[secrets] vault missing keys for "${service.name}": ${missing.join(", ")}`);
    }
    return filtered;
  } catch (e: any) {
    if (e.message?.startsWith("[secrets]")) throw e;
    throw new Error(`[secrets] vault unreachable at ${vaultUrl} for "${service.name}": ${e.message}`);
  }
}

// ── Hashing ──

/**
 * Recursively MD5-hash a directory tree (ignoring dotfiles and node_modules).
 */
export function hashDir(dir: string): string {
  try {
    const hash = crypto.createHash("md5");
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          hash.update(hashDir(fullPath));
        } else {
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

// When REPOS_DIR is inside a monorepo (parent has .git), use the last commit
// hash for the subdirectory instead of hashing all files. Faster and git-aware.
const MONOREPO_ROOT = path.resolve(REPOS_DIR, "..");
const MONOREPO_GIT = path.join(MONOREPO_ROOT, ".git");

/**
 * Git-aware hash for a repo path: uses last commit hash for monorepo
 * subdirectories, falls back to filesystem hash otherwise.
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

// ── Git Cloning ──

/**
 * Clone a service repo (via git archive) and prune old clones.
 * @returns path to the clone, or null if not applicable
 */
export function ensureServiceClone(service: Service): string | null {
  const repoPath = service.repo;
  if (!repoPath) return null;

  // Only clone repos inside the monorepo
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
      execSync(
        `git -C ${MONOREPO_ROOT} archive ${commitHash} -- "${relPath}/" | tar -x -C ${cloneDir} --strip-components=2`,
        { timeout: 30000 }
      );
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

      // Keep the current one at index 0 plus up to 3 more
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
    const agentPath = path.join(REPOS_DIR, entry.name, "agent-stack.json");
    if (!fs.existsSync(agentPath)) continue;
    try {
      const raw = fs.readFileSync(agentPath, "utf-8");
      const service = JSON.parse(raw) as Service;
      if (!service.name) {
        console.error(`[services] ${agentPath} has no "name" field — skipping`);
        continue;
      }
      service.repo = path.join(REPOS_DIR, entry.name);
      service._file = `${service.name}.json`;
      service._fromRepo = true;

      service._hash = repoHashForPath(service.repo!);

      results.push(service);
    } catch (e: any) {
      console.error(`[services] failed to load ${agentPath}: ${e.message} — skipping`);
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

  // 1. Scan repos for agent-stack.json — these are the source of truth
  const repoServices = scanRepoAgentConfigs();
  for (const svc of repoServices) {
    nameIndex[svc.name] = svc;
    services.push(svc);
  }

  // 2. Load desired/*.json — only for services WITHOUT a repo directory
  let files: string[] = [];
  try {
    files = fs.readdirSync(DESIRED_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    // dir might not exist
  }
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DESIRED_DIR, f), "utf-8");
      const service = JSON.parse(raw) as Service;

      if (!service.name) {
        console.error(`[services] ${f} has no "name" field — skipping`);
        continue;
      }
      if (nameIndex[service.name]) {
        console.error(
          `[services] ${f} skipped — ${service.name} already defined by repo agent-stack.json`
        );
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
