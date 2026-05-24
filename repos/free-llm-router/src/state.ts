import { ProviderState } from './types.js';

export class ProviderStateManager {
  private states = new Map<string, ProviderState>();

  get(key: string): ProviderState {
    let s = this.states.get(key);
    if (!s) {
      s = { key, health: 'unknown', lastHealthCheck: 0, lastActiveAt: 0, latencyMs: [], cooldownUntil: 0, modelCooldowns: {}, consecutiveFailures: 0 };
      this.states.set(key, s);
    }
    return s;
  }

  recordLatency(key: string, ms: number): void {
    const s = this.get(key);
    s.latencyMs.push(ms);
    if (s.latencyMs.length > 20) s.latencyMs.shift();
    s.lastActiveAt = Date.now();
  }

  recordSuccess(key: string): void {
    const s = this.get(key);
    s.consecutiveFailures = 0;
    s.health = s.health === 'error' || s.health === 'down' || s.health === 'unauthenticated' ? 'degraded' : 'healthy';
  }

  recordFailure(key: string): void {
    const s = this.get(key);
    s.consecutiveFailures++;
    if (s.consecutiveFailures >= 3) s.health = 'error';
    else if (s.consecutiveFailures >= 1) s.health = 'degraded';
  }

  setCooldown(key: string, until: number): void {
    this.get(key).cooldownUntil = until;
  }

  isInCooldown(key: string): boolean {
    return Date.now() < this.get(key).cooldownUntil;
  }

  setModelCooldown(key: string, modelId: string, until: number): void {
    this.get(key).modelCooldowns[modelId] = until;
  }

  isModelInCooldown(key: string, modelId: string): boolean {
    const until = this.get(key).modelCooldowns[modelId];
    return until !== undefined && Date.now() < until;
  }

  clearModelCooldown(key: string, modelId: string): void {
    delete this.get(key).modelCooldowns[modelId];
  }

  markHealthy(key: string): void {
    const s = this.get(key);
    s.health = 'healthy';
    s.lastHealthCheck = Date.now();
  }

  markUnauthenticated(key: string): void {
    const s = this.get(key);
    s.health = 'unauthenticated';
    s.lastHealthCheck = Date.now();
  }

  avgLatency(key: string): number {
    const ms = this.get(key).latencyMs;
    if (ms.length === 0) return 0;
    return ms.reduce((a, b) => a + b, 0) / ms.length;
  }

  getAllStates(): Array<{ key: string; state: ProviderState }> {
    return Array.from(this.states.entries()).map(([key, state]) => ({ key, state }));
  }
}
