import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ProviderEntry, ProviderConfig, ModelInfo } from './types.js';

const ENV_CONFIG_DIR = process.env.FREE_LLM_ROUTER_CONFIG_DIR || join(homedir(), '.free-llm-router');

const DEFAULT_PROVIDERS: ProviderEntry[] = [
  { key: 'groq', envKey: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions' },
  { key: 'openrouter', envKey: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  { key: 'cerebras', envKey: 'CEREBRAS_API_KEY', baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions' },
  { key: 'mistral', envKey: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions' },
  { key: 'sambanova', envKey: 'SAMBANOVA_API_KEY', baseUrl: 'https://api.sambanova.ai/v1', api: 'openai-completions' },
  { key: 'nvidia-nim', envKey: 'NVIDIANIM_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions' },
  { key: 'ollama', envKey: 'OLLAMA_API_KEY', baseUrl: 'http://localhost:11434/v1', api: 'openai-completions' },
];

export function getConfigDir(): string {
  if (!existsSync(ENV_CONFIG_DIR)) mkdirSync(ENV_CONFIG_DIR, { recursive: true });
  return ENV_CONFIG_DIR;
}

function writeDefaultProviders(path: string): void {
  const data = JSON.stringify({ providers: DEFAULT_PROVIDERS }, null, 2);
  writeFileSync(path, data + '\n');
}

export function loadProviders(): ProviderEntry[] {
  const dir = getConfigDir();
  const path = join(dir, 'providers.json');

  let entries: ProviderEntry[] = [];
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      entries = raw.providers || raw;
    } catch { /* corrupt, rewrite */ }
  }

  if (entries.length === 0) {
    entries = DEFAULT_PROVIDERS;
    writeDefaultProviders(path);
  }

  return entries.filter(e => !!process.env[e.envKey]);
}

export function resolveProviderConfigs(entries: ProviderEntry[], models: Record<string, ModelInfo[]>): ProviderConfig[] {
  return entries.map(e => ({
    key: e.key,
    apiKey: process.env[e.envKey] || '',
    baseUrl: e.baseUrl,
    maxRetries: 3,
    timeout: 30_000,
    priority: e.priority ?? 0,
    models: models[e.key] || [],
  })).filter(p => p.models.length > 0);
}

export function estimateTokens(messages: { content: string | null }[]): number {
  let total = 0;
  for (const m of messages) total += Math.ceil((m.content || '').length / 4);
  return total;
}
