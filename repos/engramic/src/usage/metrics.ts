import type { UsageMetrics } from "../types.js"

export class MetricsCollector {
  private compressionRatios: number[] = []
  private expansionCount = 0
  private rehydrationCount = 0
  private summaryHits = 0
  private summaryMisses = 0
  private tokenSavings: number[] = []
  private latencies: number[] = []
  private requestCount = 0
  private spanCount = 0
  private totalOriginalTokens = 0
  private totalCompressedTokens = 0

  recordCompression(originalTokens: number, compressedTokens: number, ratio: number): void {
    this.compressionRatios.push(ratio)
    this.totalOriginalTokens += originalTokens
    this.totalCompressedTokens += compressedTokens
    this.tokenSavings.push(originalTokens - compressedTokens)
    this.spanCount++
  }

  recordExpansion(): void {
    this.expansionCount++
  }

  recordRehydration(): void {
    this.rehydrationCount++
  }

  recordSummaryHit(hit: boolean): void {
    if (hit) this.summaryHits++
    else this.summaryMisses++
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms)
  }

  recordRequest(): void {
    this.requestCount++
  }

  snapshot(): UsageMetrics {
    const totalSummaries = this.summaryHits + this.summaryMisses
    return {
      compressionRatio: this.compressionRatios.length > 0
        ? this.compressionRatios.reduce((a, b) => a + b, 0) / this.compressionRatios.length
        : 0,
      memoryExpansionRate: this.spanCount > 0 ? this.expansionCount / this.spanCount : 0,
      averageTokenSavings: this.tokenSavings.length > 0
        ? this.tokenSavings.reduce((a, b) => a + b, 0) / this.tokenSavings.length
        : 0,
      summaryHitRate: totalSummaries > 0 ? this.summaryHits / totalSummaries : 0,
      providerLatency: this.latencies.length > 0
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
        : 0,
      rehydrationFrequency: this.requestCount > 0 ? this.rehydrationCount / this.requestCount : 0,
    }
  }

  reset(): void {
    this.compressionRatios = []
    this.expansionCount = 0
    this.rehydrationCount = 0
    this.summaryHits = 0
    this.summaryMisses = 0
    this.tokenSavings = []
    this.latencies = []
    this.requestCount = 0
    this.spanCount = 0
    this.totalOriginalTokens = 0
    this.totalCompressedTokens = 0
  }
}
