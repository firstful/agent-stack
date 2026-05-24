import crypto from 'crypto';
import { ChatCompletionRequest, ChatCompletionResponse, ModelTier, ProviderConfig, ModelInfo, ProviderEntry } from './types.js';
import { Provider } from './providers/base.js';
import { OpenAICompatProvider } from './providers/openai-compat.js';
import { GeminiProvider } from './providers/gemini.js';
import { ProviderStateManager } from './state.js';
import { ScoringEngine } from './score.js';
import { ErrorClassifier } from './error-classifier.js';
import { estimateTokens } from './config.js';
import { SCORE_THRESHOLD } from './score.js';

export class LLMRouter {
  getProviderKeys(): string[] {
    return Array.from(this.providers.keys());
  }
  private providers = new Map<string, Provider>();
  private providerConfigs = new Map<string, ProviderConfig>();
  private models: Array<{ pkey: string; model: ModelInfo }> = [];
  private state: ProviderStateManager;
  private scorer: ScoringEngine;
  private classifier: ErrorClassifier;

  constructor(
    configs: ProviderConfig[],
    state: ProviderStateManager,
    classifier: ErrorClassifier,
  ) {
    this.state = state;
    this.scorer = new ScoringEngine(state);
    this.classifier = classifier;

    for (const cfg of configs) {
      const p = cfg.key === 'gemini' ? new GeminiProvider(cfg) : new OpenAICompatProvider(cfg);
      this.providers.set(cfg.key, p);
      this.providerConfigs.set(cfg.key, cfg);
      for (const model of cfg.models) {
        this.models.push({ pkey: cfg.key, model });
      }
    }
  }

  async chat(req: ChatCompletionRequest): Promise<{ response: ChatCompletionResponse; providerUsed: string }> {
    const reqId = crypto.randomUUID().slice(0, 8);
    const startMs = Date.now();
    const estimatedTokens = estimateTokens(req.messages);
    const needsReasoning = !!(req as any).reasoning_effort;

    console.log(`[chat:${reqId}] start model=${req.model} tokens=${estimatedTokens} reasoning=${needsReasoning} messages=${req.messages.length}`);

    const errors: string[] = [];
    const tried: Set<string> = new Set();

    const ranked = this.scorer.rankProviders(this.toCandidates(this.models), estimatedTokens, needsReasoning);
    console.log(`[chat:${reqId}] ranked=${ranked.length}`);
    for (const { entry, model } of this.pickProviders(ranked)) {
      const key = `${entry.key}/${model.id}`;
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        console.log(`[chat:${reqId}] attempt ${key}`);
        const result = await this.executeCall(entry.key, model, req);
        const dur = Date.now() - startMs;
        console.log(`[chat:${reqId}] OK ${key} latency=${dur}ms tokens=${result.response.usage.total_tokens} finish=${result.response.choices[0]?.finish_reason}`);
        return result;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        console.log(`[chat:${reqId}] FAIL ${key}: status=${this.extractStatus(msg)} ${msg.replace(/\n/g, ' ')}`);
        errors.push(`${key}: ${msg}`);
      }
    }

    console.log(`[chat:${reqId}] desperate -- trying every provider ignoring cooldowns`);
    for (const { pkey, model } of this.models) {
      const key = `${pkey}/${model.id}`;
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        console.log(`[chat:${reqId}] desperate ${key}`);
        const result = await this.executeCall(pkey, model, req);
        const dur = Date.now() - startMs;
        console.log(`[chat:${reqId}] OK ${key} latency=${dur}ms tokens=${result.response.usage.total_tokens} finish=${result.response.choices[0]?.finish_reason}`);
        return result;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        console.log(`[chat:${reqId}] FAIL desperate ${key}: ${msg.replace(/\n/g, ' ')}`);
        errors.push(`desperate/${key}: ${msg}`);
      }
    }

    throw new Error(`All providers failed:\n${errors.join('\n')}`);
  }

  async *streamChat(req: ChatCompletionRequest): AsyncGenerator<{ chunk: string; providerUsed: string }> {
    const reqId = crypto.randomUUID().slice(0, 8);
    const estimatedTokens = estimateTokens(req.messages);
    const needsReasoning = !!(req as any).reasoning_effort;

    console.log(`[stream:${reqId}] start model=${req.model} tokens=${estimatedTokens} messages=${req.messages.length}`);

    const errors: string[] = [];
    const tried: Set<string> = new Set();

    const ranked = this.scorer.rankProviders(this.toCandidates(this.models), estimatedTokens, needsReasoning);
    console.log(`[stream:${reqId}] ranked=${ranked.length}`);
    for (const { entry, model } of this.pickProviders(ranked)) {
      const key = `${entry.key}/${model.id}`;
      if (tried.has(key)) continue;
      tried.add(key);
      console.log(`[stream:${reqId}] attempt ${key}`);
      try {
        for await (const chunk of this.streamCall(entry.key, model, req)) {
          yield chunk;
        }
        console.log(`[stream:${reqId}] OK ${key}`);
        return;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        console.log(`[stream:${reqId}] FAIL ${key}: status=${this.extractStatus(msg)} ${msg.replace(/\n/g, ' ')}`);
        errors.push(`${key}: ${msg}`);
      }
    }

    console.log(`[stream:${reqId}] desperate -- trying every provider ignoring cooldowns`);
    for (const { pkey, model } of this.models) {
      const key = `${pkey}/${model.id}`;
      if (tried.has(key)) continue;
      tried.add(key);
      console.log(`[stream:${reqId}] desperate ${key}`);
      try {
        for await (const chunk of this.streamCall(pkey, model, req)) {
          yield chunk;
        }
        console.log(`[stream:${reqId}] OK ${key}`);
        return;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        console.log(`[stream:${reqId}] FAIL desperate ${key}: ${msg.replace(/\n/g, ' ')}`);
        errors.push(`desperate/${key}: ${msg}`);
      }
    }

    console.log(`[stream:${reqId}] ALL_FAILED`);
    throw new Error(`All providers failed for stream:\n${errors.join('\n')}`);
  }

  private toCandidates(items: Array<{ pkey: string; model: ModelInfo }>) {
    const map = new Map<string, { entry: ProviderEntry; models: ModelInfo[] }>();
    for (const item of items) {
      const cfg = this.providerConfigs.get(item.pkey);
      if (!cfg) continue;
      const entry = { key: cfg.key, envKey: '', baseUrl: cfg.baseUrl, api: cfg.key === 'gemini' ? 'gemini' as const : 'openai-completions' as const, priority: cfg.priority };
      if (!map.has(item.pkey)) map.set(item.pkey, { entry, models: [] });
      map.get(item.pkey)!.models.push(item.model);
    }
    return Array.from(map.values());
  }

  private async executeCall(pkey: string, model: ModelInfo, req: ChatCompletionRequest): Promise<{ response: ChatCompletionResponse; providerUsed: string }> {
    const provider = this.providers.get(pkey)!;
    const start = Date.now();
    try {
      const request = { ...req, model: model.id };
      const response = await provider.chat(request);
      this.state.recordSuccess(pkey);
      this.state.recordLatency(pkey, Date.now() - start);
      return { response, providerUsed: pkey };
    } catch (e) {
      const err = e as Error;
      this.state.recordFailure(pkey);
      const status = this.extractStatus(err.message);
      const body = err.message;
      const { category, ruleId } = this.classifier.classify(pkey, status, body);
      this.classifier.recordError(pkey, status, body, category, ruleId);

      if (category === 'config') { this.state.get(pkey).health = 'unauthenticated'; }
      if (category === 'rate_limit') {
        const retryAfter = this.extractRetryAfter(body);
        const cooldownMs = retryAfter !== null ? retryAfter * 1000 : 30_000;
        const until = Date.now() + cooldownMs;
        const isModelSpecific = body.includes(model.id);
        if (isModelSpecific) {
          this.state.setModelCooldown(pkey, model.id, until);
        } else {
          this.state.setCooldown(pkey, until);
        }
        console.log(`[rate_limit] ${pkey} model=${model.id} retryAfter=${retryAfter ?? 'default'} cooldown=${cooldownMs}ms until=${new Date(until).toISOString()}`);
      }

      if (category === 'transient' || category === 'rate_limit') {
        const retries = 3;
        for (let i = 0; i < retries; i++) {
          const delay = Math.min(1000 * Math.pow(2, i), 10_000);
          console.log(`[retry] chat ${pkey}/${model.id} attempt=${i + 1}/${retries} retryAfter=${delay}ms category=${category}`);
          await new Promise(r => setTimeout(r, delay));
          try {
            const response = await provider.chat({ ...req, model: model.id });
            this.state.recordSuccess(pkey);
            this.state.recordLatency(pkey, Date.now() - start);
            this.state.clearModelCooldown(pkey, model.id);
            return { response, providerUsed: pkey };
          } catch (e) {
            this.state.recordFailure(pkey);
            console.log(`[retry] FAIL chat ${pkey}/${model.id} attempt=${i + 1}/${retries}: ${(e as Error).message.slice(0, 200)}`);
          }
        }
      }

      throw e;
    }
  }

  private async *streamCall(pkey: string, model: ModelInfo, req: ChatCompletionRequest): AsyncGenerator<{ chunk: string; providerUsed: string }> {
    const provider = this.providers.get(pkey)!;
    const retries = 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        for await (const chunk of provider.streamChat({ ...req, model: model.id })) {
          yield { chunk, providerUsed: pkey };
        }
        this.state.recordSuccess(pkey);
        return;
      } catch (e) {
        this.state.recordFailure(pkey);
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5_000);
          console.log(`[retry] stream ${pkey}/${model.id} attempt=${attempt + 1}/${retries} retryAfter=${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw e;
        }
      }
    }
  }

  private extractStatus(msg: string): number {
    const m = msg.match(/\b(\d{3})\b/);
    return m ? parseInt(m[1]) : 0;
  }

  private pickProviders(ranked: Array<{ entry: ProviderEntry; model: ModelInfo; score: number }>) {
    const eligible = ranked.filter(r => r.score > SCORE_THRESHOLD);
    if (eligible.length > 1) {
      const shuffled = [...eligible];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    return ranked;
  }

  getProviderScores(): Array<{ key: string; score: number }> {
    return Array.from(this.providerConfigs.keys()).map(key => {
      const cfg = this.providerConfigs.get(key)!;
      const entry = { key: cfg.key, envKey: '', baseUrl: cfg.baseUrl, api: 'openai-completions' as const, priority: cfg.priority };
      return { key, score: this.scorer.scoreProvider(entry) };
    });
  }

  private extractRetryAfter(msg: string): number | null {
    const m = msg.match(/\[retry-after=(\d+)\]/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  getModelsByTier(_tier: ModelTier): ModelInfo[] {
    return this.models.map(x => x.model);
  }

  async debugTestModel(provider: string, modelId: string): Promise<TestModelResult> {
    const prov = this.providers.get(provider);
    if (!prov) return { provider, model: modelId, success: false, latencyMs: 0, statusCode: 0, error: `Unknown provider: ${provider}` };

    let foundModel: ModelInfo | null = null;
    for (const { pkey, model } of this.models) {
      if (pkey === provider && model.id === modelId) { foundModel = model; break; }
    }
    if (!foundModel) return { provider, model: modelId, success: false, latencyMs: 0, statusCode: 0, error: `Model ${modelId} not found for provider ${provider}` };

    const testReq: ChatCompletionRequest = {
      model: modelId,
      messages: [{ role: 'user', content: 'Say exactly one word: hello' }],
      max_tokens: 32,
    };

    const start = Date.now();
    try {
      const response = await prov.chat(testReq);
      const latencyMs = Date.now() - start;
      this.state.recordSuccess(provider);
      this.state.recordLatency(provider, latencyMs);
      const content = response.choices?.[0]?.message?.content || '';
      return {
        provider,
        model: modelId,
        success: true,
        latencyMs,
        statusCode: 200,
        responseSnippet: content.slice(0, 200),
        finishReason: response.choices?.[0]?.finish_reason || null,
        tokenUsage: response.usage,
      };
    } catch (e) {
      const latencyMs = Date.now() - start;
      this.state.recordFailure(provider);
      const err = e as Error;
      const status = this.extractStatus(err.message);
      return {
        provider,
        model: modelId,
        success: false,
        latencyMs,
        statusCode: status || 0,
        error: err.message.slice(0, 500),
      };
    }
  }

  async debugRoute(options: { model?: string; provider?: string }): Promise<DebugRouteResult> {
    const estimatedTokens = 1000;
    const needsReasoning = false;
    const providerFilter = options.provider || null;

    let filtered = this.models;
    if (providerFilter) {
      filtered = this.models.filter(m => m.pkey === providerFilter);
    }

    const candidates = filtered.map(c => {
      const state = this.state.get(c.pkey);
      const entry: ProviderEntry = { key: c.pkey, envKey: '', baseUrl: '', api: 'openai-completions', priority: this.providerConfigs.get(c.pkey)?.priority ?? 0 };
      const score = this.scorer.scoreProvider(entry);
      return {
        provider: c.pkey,
        modelId: c.model.id,
        modelTier: 'default',
        contextWindow: c.model.contextWindow,
        score,
        health: state.health,
        onCooldown: this.state.isInCooldown(c.pkey),
        modelOnCooldown: this.state.isModelInCooldown(c.pkey, c.model.id),
      };
    });

    const ranked = this.scorer.rankProviders(this.toCandidates(filtered), estimatedTokens, needsReasoning);
    const selected = ranked.length > 0 ? { provider: ranked[0].entry.key, modelId: ranked[0].model.id, score: ranked[0].score } : null;

    const providerStates = this.state.getAllStates().map(s => ({
      key: s.key,
      health: s.state.health,
      cooldownUntil: s.state.cooldownUntil,
      modelCooldowns: s.state.modelCooldowns,
      avgLatency: this.state.avgLatency(s.key),
      consecutiveFailures: s.state.consecutiveFailures,
    }));

    return {
      requested: { model: options.model || 'default', providerFilter },
      resolution: { estimatedTokens },
      candidates,
      selected,
      providerStates,
    };
  }
}

export interface TestModelResult {
  provider: string;
  model: string;
  success: boolean;
  latencyMs: number;
  statusCode: number;
  error?: string;
  responseSnippet?: string;
  finishReason?: string | null;
  tokenUsage?: Record<string, number> | null;
}

interface DebugCandidate {
  provider: string;
  modelId: string;
  modelTier: string;
  contextWindow: number;
  score: number;
  health: string;
  onCooldown: boolean;
  modelOnCooldown: boolean;
}

interface DebugRouteResult {
  requested: { model: string; providerFilter: string | null };
  resolution: { estimatedTokens: number };
  candidates: DebugCandidate[];
  selected: { provider: string; modelId: string; score: number } | null;
  providerStates: Array<{
    key: string;
    health: string;
    cooldownUntil: number;
    modelCooldowns: Record<string, number>;
    avgLatency: number;
    consecutiveFailures: number;
  }>;
}
