import { ModelInfo } from './types.js';

export const SEED_MODEL_CATALOG: Record<string, Omit<ModelInfo, 'tier'>> = {
  'groq/llama-3.3-70b-versatile': { id: 'llama-3.3-70b-versatile', provider: 'groq', name: 'Llama 3.3 70B', contextWindow: 128_000, maxTokens: 32_768, reasoning: false, input: ['text'], parameterSize: '70B' },
  'openrouter/free': { id: 'openrouter/free', provider: 'openrouter', name: 'OpenRouter Free', contextWindow: 200_000, maxTokens: 32_768, reasoning: false, input: ['text'], parameterSize: '70B' },
  'cerebras/llama-3.1-8b': { id: 'llama-3.1-8b', provider: 'cerebras', name: 'Llama 3.1 8B', contextWindow: 128_000, maxTokens: 32_768, reasoning: false, input: ['text'], parameterSize: '8B' },
  'mistral/mistral-small-latest': { id: 'mistral-small-latest', provider: 'mistral', name: 'Mistral Small', contextWindow: 32_000, maxTokens: 8_192, reasoning: false, input: ['text'] },
  'sambanova/gemma-3-12b-it': { id: 'gemma-3-12b-it', provider: 'sambanova', name: 'Gemma 3 12B', contextWindow: 32_768, maxTokens: 8_192, reasoning: false, input: ['text'], parameterSize: '12B' },
  'nvidia-nim/meta/llama-3.1-8b-instruct': { id: 'meta/llama-3.1-8b-instruct', provider: 'nvidia-nim', name: 'Llama 3.1 8B', contextWindow: 128_000, maxTokens: 32_768, reasoning: false, input: ['text'], parameterSize: '8B' },
};
