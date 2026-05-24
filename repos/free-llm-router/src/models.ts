import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ModelInfo, ProviderEntry, ProviderModelsCache } from './types.js';
import { SEED_MODEL_CATALOG } from './tier-seeds.js';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export class ModelManager {
  private cache: Map<string, ProviderModelsCache> = new Map();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  cachePath(key: string): string {
    return join(this.dataDir, `provider-${key}-models.json`);
  }

  loadCache(key: string): ProviderModelsCache | null {
    const path = this.cachePath(key);
    if (!existsSync(path)) {
        console.log(`Cache miss for ${key}`);
        return null;
      }
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw) as ProviderModelsCache;
      if (Date.now() < parsed.ttl) {
        this.cache.set(key, parsed);
        return parsed;
      }
    } catch { /* corrupted cache */ }
    return null;
  }

  writeCache(key: string, models: ModelInfo[]): void {
    const cache: ProviderModelsCache = { ttl: Date.now() + CACHE_TTL_MS, models };
    this.cache.set(key, cache);
    const path = this.cachePath(key);
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(cache, null, 2));
    renameSync(tmp, path);
  }

  getCached(key: string): ModelInfo[] | null {
    const c = this.cache.get(key);
    if (c && Date.now() < c.ttl) return c.models;
    return null;
  }

  async discover(entry: ProviderEntry): Promise<ModelInfo[]> {
    const cached = this.loadCache(entry.key);
    if (cached) return cached.models;

    const models = this.seedModels(entry.key);

    if (models.length > 0) {
      this.writeCache(entry.key, models);
    }
    return models;
  }

  private seedModels(provider: string): ModelInfo[] {
    const result: ModelInfo[] = [];
    for (const [key, m] of Object.entries(SEED_MODEL_CATALOG)) {
      if (key.startsWith(`${provider}/`)) {
        result.push({ ...m, tier: 'default' } as ModelInfo);
      }
    }
    return result;
  }
}

import { renameSync as fsRenameSync, unlinkSync } from 'fs';
function renameSync(from: string, to: string): void {
  try { fsRenameSync(from, to); } catch {
    try { writeFileSync(to, readFileSync(from)); unlinkSync(from); } catch { /* ignore */ }
  }
}
