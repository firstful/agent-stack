import type { PricingEntry } from "../types.js"

const DEFAULT_PRICING: PricingEntry[] = [
  { modelPrefix: "gpt-4o", inputPer1K: 0.0025, outputPer1K: 0.01 },
  { modelPrefix: "gpt-4o-mini", inputPer1K: 0.00015, outputPer1K: 0.0006 },
  { modelPrefix: "gpt-4-turbo", inputPer1K: 0.01, outputPer1K: 0.03 },
  { modelPrefix: "gpt-4", inputPer1K: 0.03, outputPer1K: 0.06 },
  { modelPrefix: "gpt-3.5-turbo", inputPer1K: 0.001, outputPer1K: 0.002 },
  { modelPrefix: "gpt-3.5", inputPer1K: 0.001, outputPer1K: 0.002 },
  { modelPrefix: "claude-3-opus", inputPer1K: 0.015, outputPer1K: 0.075 },
  { modelPrefix: "claude-3-sonnet", inputPer1K: 0.003, outputPer1K: 0.015 },
  { modelPrefix: "claude-3-haiku", inputPer1K: 0.00025, outputPer1K: 0.00125 },
  { modelPrefix: "claude-2", inputPer1K: 0.008, outputPer1K: 0.024 },
  { modelPrefix: "deepseek-chat", inputPer1K: 0.0005, outputPer1K: 0.0015 },
  { modelPrefix: "deepseek-reasoner", inputPer1K: 0.001, outputPer1K: 0.002 },
  { modelPrefix: "llama", inputPer1K: 0.0005, outputPer1K: 0.001 },
  { modelPrefix: "mistral", inputPer1K: 0.0005, outputPer1K: 0.001 },
]

function loadCustomPricing(): PricingEntry[] {
  const raw = process.env.ENGRA_PRICING
  if (!raw) return []
  try {
    return JSON.parse(raw) as PricingEntry[]
  } catch {
    return []
  }
}

export class PricingEngine {
  private entries: PricingEntry[]

  constructor(customEntries?: PricingEntry[]) {
    const custom = customEntries || loadCustomPricing()
    const combined = [...custom, ...DEFAULT_PRICING]
    const seen = new Set<string>()
    this.entries = []
    for (const e of combined) {
      if (!seen.has(e.modelPrefix)) {
        seen.add(e.modelPrefix)
        this.entries.push(e)
      }
    }
    this.entries.sort((a, b) => b.modelPrefix.length - a.modelPrefix.length)
  }

  lookup(model: string): PricingEntry {
    for (const e of this.entries) {
      if (model.startsWith(e.modelPrefix)) return e
    }
    return { modelPrefix: "unknown", inputPer1K: 0.003, outputPer1K: 0.015 }
  }

  computeCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = this.lookup(model)
    return (promptTokens / 1000) * pricing.inputPer1K + (completionTokens / 1000) * pricing.outputPer1K
  }
}
