import { ErrorRule } from './types.js';

export function seedRules(): ErrorRule[] {
  const now = new Date().toISOString();
  const shared: ErrorRule[] = [
    { id: 'shared-rate-limit', provider: '_shared', category: 'rate_limit', pattern: 'rate.limit|429|too many requests|quota exceeded', flags: 'i', source: 'seed', description: 'Generic rate limit', createdAt: now },
    { id: 'shared-unauthorized', provider: '_shared', category: 'config', pattern: 'unauthorized|invalid api key|401|api key.*invalid|key.*expired|credential', flags: 'i', source: 'seed', description: 'Generic auth failure', createdAt: now },
    { id: 'shared-context-length', provider: '_shared', category: 'format', pattern: 'context.length.exceeded|maximum context|too many tokens|token limit', flags: 'i', source: 'seed', description: 'Context window exceeded', createdAt: now },
    { id: 'shared-timeout', provider: '_shared', category: 'transient', pattern: 'timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed', flags: 'i', source: 'seed', description: 'Generic timeout/network error', createdAt: now },
    { id: 'shared-5xx', provider: '_shared', category: 'transient', pattern: '^5\\d{2}$', flags: '', source: 'seed', description: 'Server error (5xx)', createdAt: now },
    { id: 'shared-bad-request', provider: '_shared', category: 'format', pattern: '^400$|bad request|invalid.*parameter|unsupported.*param', flags: 'i', source: 'seed', description: 'Bad request format', createdAt: now },
  ];
  const groq: ErrorRule[] = [
    { id: 'groq-rate-limit', provider: 'groq', category: 'rate_limit', pattern: 'rate_limit_exceeded|429|too many requests', flags: 'i', source: 'seed', description: 'Groq rate limit', createdAt: now },
    { id: 'groq-auth', provider: 'groq', category: 'config', pattern: 'invalid_api_key|401|unauthorized', flags: 'i', source: 'seed', description: 'Groq auth failure', createdAt: now },
  ];
  const gemini: ErrorRule[] = [
    { id: 'gemini-rate-limit', provider: 'gemini', category: 'rate_limit', pattern: 'RATE_LIMIT|quota_exceeded|429|RESOURCE_EXHAUSTED', flags: 'i', source: 'seed', description: 'Gemini rate limit', createdAt: now },
    { id: 'gemini-auth', provider: 'gemini', category: 'config', pattern: 'API_KEY_INVALID|API key not valid|PERMISSION_DENIED|auth.error|invalid.api.key', flags: 'i', source: 'seed', description: 'Gemini auth failure', createdAt: now },
  ];
  const openrouter: ErrorRule[] = [
    { id: 'or-rate-limit', provider: 'openrouter', category: 'rate_limit', pattern: 'rate.limited|429|too many', flags: 'i', source: 'seed', description: 'OpenRouter rate limit', createdAt: now },
    { id: 'or-auth', provider: 'openrouter', category: 'config', pattern: 'invalid.*key|unauthorized|401|no.*api.*key', flags: 'i', source: 'seed', description: 'OpenRouter auth failure', createdAt: now },
    { id: 'or-insufficient-credits', provider: 'openrouter', category: 'config', pattern: 'insufficient.*credit|free.*limit|out.of.*credit', flags: 'i', source: 'seed', description: 'OpenRouter out of credits', createdAt: now },
  ];
  const mistral: ErrorRule[] = [
    { id: 'mistral-rate-limit', provider: 'mistral', category: 'rate_limit', pattern: 'too many|429|rate', flags: 'i', source: 'seed', description: 'Mistral rate limit', createdAt: now },
    { id: 'mistral-auth', provider: 'mistral', category: 'config', pattern: 'invalid.*key|unauthorized|401|auth.*fail', flags: 'i', source: 'seed', description: 'Mistral auth failure', createdAt: now },
  ];
  const cerebras: ErrorRule[] = [
    { id: 'cerebras-rate-limit', provider: 'cerebras', category: 'rate_limit', pattern: 'rate|429', flags: 'i', source: 'seed', description: 'Cerebras rate limit', createdAt: now },
    { id: 'cerebras-auth', provider: 'cerebras', category: 'config', pattern: 'invalid.*key|401|unauthorized', flags: 'i', source: 'seed', description: 'Cerebras auth failure', createdAt: now },
  ];
  const deepseek: ErrorRule[] = [
    { id: 'deepseek-rate-limit', provider: 'deepseek', category: 'rate_limit', pattern: 'rate|429|too fast', flags: 'i', source: 'seed', description: 'DeepSeek rate limit', createdAt: now },
    { id: 'deepseek-auth', provider: 'deepseek', category: 'config', pattern: 'invalid.*key|401|unauthorized|auth.*fail', flags: 'i', source: 'seed', description: 'DeepSeek auth failure', createdAt: now },
    { id: 'deepseek-insufficient-balance', provider: 'deepseek', category: 'config', pattern: 'insufficient.*balance|out.of.*quota', flags: 'i', source: 'seed', description: 'DeepSeek out of credits', createdAt: now },
  ];
  const cohere: ErrorRule[] = [
    { id: 'cohere-rate-limit', provider: 'cohere', category: 'rate_limit', pattern: 'rate|429|too many', flags: 'i', source: 'seed', description: 'Cohere rate limit', createdAt: now },
    { id: 'cohere-auth', provider: 'cohere', category: 'config', pattern: 'invalid.*key|401|unauthorized|no.*api.*key', flags: 'i', source: 'seed', description: 'Cohere auth failure', createdAt: now },
  ];
  return [...shared, ...groq, ...gemini, ...openrouter, ...mistral, ...cerebras, ...deepseek, ...cohere];
}
