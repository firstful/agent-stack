import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import type { Service } from "./types";
import { DESIRED_DIR, REPOS_DIR, INFRA_DIR } from "./config";

const VAULT_TOKEN = process.env.VAULT_TOKEN || "";

export function resolveSecrets(service: Service): Record<string, string> {
  if (!service.secrets || !Array.isArray(service.secrets)) return {};
  if (!VAULT_TOKEN) {
    return {};
  }
  try {
    const vaultUrl = process.env.VAULT_URL || "http://localhost:4006";
    const curl = `curl -sf ${vaultUrl}/api/secrets/plain/${service.name} -H "Authorization: Bearer ${VAULT_TOKEN}"`;
    const raw = execSync(curl, { timeout: 5000, encoding: "utf8" });
    const result = JSON.parse(raw);
    if (!result.secrets) return {};
    const filtered: Record<string, string> = {};
    for (const key of service.secrets) {
      if (result.secrets[key] !== undefined) filtered[key] = result.secrets[key];
    }
    return filtered;
  } catch {
    return {};
  }
}

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

      const configHash = crypto.createHash("md5").update(raw).digest("hex");
      let repoHash = "";
      const wipFile = path.join(service.repo!, ".wip");
      if (!fs.existsSync(wipFile)) {
        repoHash = repoHashForPath(service.repo!);
      }
      service._hash = crypto
        .createHash("md5")
        .update(configHash + repoHash)
        .digest("hex");

      results.push(service);
    } catch (e: any) {
      console.error(`[services] failed to load ${agentPath}: ${e.message} — skipping`);
    }
  }
  return results;
}

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

      const configHash = crypto.createHash("md5").update(raw).digest("hex");
      let repoHash = "";
      if (service.repo) {
        const wipFile = path.join(service.repo, ".wip");
        if (!fs.existsSync(wipFile)) {
          repoHash = repoHashForPath(service.repo);
        }
      }
      service._hash = crypto
        .createHash("md5")
        .update(configHash + repoHash)
        .digest("hex");

      nameIndex[service.name] = service;
      services.push(service);
    } catch (e: any) {
      console.error(`[services] failed to load ${f}: ${e.message} — skipping`);
    }
  }
  return services;
}
