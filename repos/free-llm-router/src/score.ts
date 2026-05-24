import { ModelInfo, ProviderEntry } from './types.js';
import { ProviderStateManager } from './state.js';

export const SCORE_THRESHOLD = 0;

export class ScoringEngine {
  constructor(private state: ProviderStateManager) {}

  getScore(key: string, entry?: ProviderEntry): number {
    const cfg = { key, envKey: '', baseUrl: '', api: 'openai-completions' as const, priority: 0, ...entry };
    return this.scoreProvider(cfg);
  }

  scoreProvider(entry: ProviderEntry): number {
    const state = this.state.get(entry.key);
    if (state.health === 'down' || state.health === 'error' || state.health === 'unauthenticated') return -100;
    if (this.state.isInCooldown(entry.key)) return -50;

    let score = 50;

    switch (state.health) {
      case 'healthy': score += 40; break;
      case 'degraded': score += 10; break;
      case 'unknown': score += 20; break;
    }

    const latency = this.state.avgLatency(entry.key);
    if (latency > 0) {
      score -= Math.min(latency / 100, 40);
    }

    score -= state.consecutiveFailures * 10;

    const idleMinutes = (Date.now() - state.lastActiveAt) / 60_000;
    if (idleMinutes > 5) score -= 5;
    if (idleMinutes > 30) score -= 10;

    if (entry.priority !== undefined) score += entry.priority * 30;

    return score;
  }

  async checkHealth(entry: ProviderEntry): Promise<boolean> {
    try {
      const res = await fetch(entry.baseUrl.replace(/\/v1\/?$/,''), {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      const ok = res.ok || res.status < 500;
      if (ok) this.state.markHealthy(entry.key);
      return ok;
    } catch {
      return false;
    }
  }

  rankProviders(
    candidates: { entry: ProviderEntry; models: ModelInfo[] }[],
    estimatedTokens: number,
    needsReasoning: boolean,
  ): Array<{ entry: ProviderEntry; model: ModelInfo; score: number }> {
    return candidates
      .filter(c => c.models.some(m => m.contextWindow >= estimatedTokens))
      .map(c => {
        const state = this.state.get(c.entry.key);
        const score = this.scoreProvider(c.entry);
        const fittingModels = c.models.filter(m =>
          m.contextWindow >= estimatedTokens &&
          !this.state.isModelInCooldown(c.entry.key, m.id)
        );
        const bestModel = fittingModels.sort((a, b) => {
          if (needsReasoning && a.reasoning !== b.reasoning) return a.reasoning ? -1 : 1;
          return b.contextWindow - a.contextWindow;
        })[0];
        return { entry: c.entry, model: bestModel, score, state };
      })
      .filter(c => c.model)
      .sort((a, b) => b.score - a.score);
  }

  async selectBestProvider(
    candidates: { entry: ProviderEntry; models: ModelInfo[] }[],
    estimatedTokens: number,
    needsReasoning: boolean,
  ): Promise<{ entry: ProviderEntry; model: ModelInfo } | null> {
    const scored = this.rankProviders(candidates, estimatedTokens, needsReasoning);

    if (scored.length > 0 && scored[0].score > -50) {
      return { entry: scored[0].entry, model: scored[0].model };
    }

    for (const c of scored) {
      const fresh = await this.checkHealth(c.entry);
      if (fresh) {
        const newScore = this.scoreProvider(c.entry);
        if (newScore > -50) return { entry: c.entry, model: c.model };
        break;
      }
    }

    const unknown = candidates
      .filter(c => this.state.get(c.entry.key).health === 'unknown')
      .map(c => ({ entry: c.entry, model: c.models[0] }))
      .filter(c => c.model);
    if (unknown.length > 0) return unknown[0];

    return null;
  }
}
