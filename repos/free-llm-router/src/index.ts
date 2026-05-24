import { createApp } from './server.js';
import { getConfigDir, loadProviders, resolveProviderConfigs } from './config.js';
import { ConversationLogger } from './conversation-logger.js';
import { ProviderStateManager } from './state.js';
import { ErrorClassifier } from './error-classifier.js';
import { ModelManager } from './models.js';
import { ProviderEntry } from './types.js';
import { join } from 'path';

const dataDir = getConfigDir();
const state = new ProviderStateManager();
const classifier = new ErrorClassifier(dataDir);
const modelManager = new ModelManager(dataDir);
const convLogger = new ConversationLogger(join(dataDir, 'conversations.jsonl'));

async function probeProviders(entries: ProviderEntry[], state: ProviderStateManager): Promise<void> {
  for (const entry of entries) {
    const apiKey = process.env[entry.envKey];
    if (!apiKey) {
      state.markUnauthenticated(entry.key);
      continue;
    }
    try {
      const res = await fetch(`${entry.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        state.markHealthy(entry.key);
      } else if (res.status === 401 || res.status === 403) {
        state.markUnauthenticated(entry.key);
      } else {
        state.get(entry.key).health = 'error';
      }
    } catch {
      state.get(entry.key).health = 'error';
    }
  }
  const states = state.getAllStates().map(s => `${s.key}=${s.state.health}`);
  console.log('Provider health:', states.join(', '));
}

async function bootstrap() {
  const entries = loadProviders();
  console.log('Configured providers:', entries.map(e=>e.key).join(', '));

  if (entries.length === 0) {
    console.log('No providers configured (no API keys found).');
    console.log('Set at least one of: GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY');
  }

  const modelMap: Record<string, import('./types.js').ModelInfo[]> = {};
  for (const entry of entries) {
    console.log(`Discovering models for ${entry.key}...`);
    const models = await modelManager.discover(entry);
    modelMap[entry.key] = models;
    console.log(`  ${models.length} models loaded for ${entry.key}`);
  }

  const configs = resolveProviderConfigs(entries, modelMap);
  const totalModels = configs.reduce((s, c) => s + c.models.length, 0);
  console.log(`Total: ${configs.length} providers, ${totalModels} models`);

  if (configs.length === 0) {
    console.log('WARNING: No models available. Server will run but all requests will fail.');
  }

  const app = createApp(configs, state, classifier, convLogger);
  const port = parseInt(process.env.PORT || '3000', 10);

  app.listen(port, () => {
    console.log(`Free LLM Router running on http://0.0.0.0:${port}`);
    console.log(`Config dir: ${dataDir}`);
    console.log(`Models: default`);
    if (configs.length > 0) {
      const first = configs[0];
      console.log(`Test: curl http://localhost:${port}/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"default","messages":[{"role":"user","content":"hi"}]}'`);
    }
    probeProviders(entries, state);
  });
}

bootstrap().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
