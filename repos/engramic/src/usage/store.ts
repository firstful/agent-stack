import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { UsageRecord, UsageSummary } from "../types.js"
import { PricingEngine } from "./pricing.js"

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"

export interface IUsageStore {
  record(usage: UsageRecord): Promise<void>
  getByUser(userId: string, since?: number): Promise<UsageRecord[]>
  getByConversation(convId: string): Promise<UsageRecord[]>
  getSummary(userId?: string, since?: number): Promise<UsageSummary>
  getGlobalSummary(since?: number): Promise<UsageSummary>
  pruneOlderThan(timestamp: number): Promise<number>
}

export class UsageStore implements IUsageStore {
  private records: UsageRecord[] = []
  private path: string
  private pricing: PricingEngine

  constructor(pricing?: PricingEngine) {
    this.path = join(DATA_DIR, "usage.ndjson")
    this.pricing = pricing || new PricingEngine()
    mkdir(DATA_DIR, { recursive: true })
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) return
    try {
      const raw = await readFile(this.path, "utf-8")
      const lines = raw.trim().split("\n").filter(Boolean)
      this.records = lines.map((l) => JSON.parse(l) as UsageRecord)
    } catch (err) {
      console.error("Failed to load usage records:", err)
    }
  }

  async record(usage: UsageRecord): Promise<void> {
    this.records.push(usage)
    try {
      await appendFile(this.path, JSON.stringify(usage) + "\n")
    } catch (err) {
      console.error("Failed to persist usage record:", err)
    }
  }

  async getByUser(userId: string, since?: number): Promise<UsageRecord[]> {
    const sinceTs = since || 0
    return this.records.filter((r) => r.userId === userId && r.createdAt >= sinceTs)
  }

  async getByConversation(convId: string): Promise<UsageRecord[]> {
    return this.records.filter((r) => r.conversationId === convId)
  }

  async getSummary(userId?: string, since?: number): Promise<UsageSummary> {
    const sinceTs = since || 0
    const filtered = userId
      ? this.records.filter((r) => r.userId === userId && r.createdAt >= sinceTs)
      : this.records.filter((r) => r.createdAt >= sinceTs)

    return this.summarize(filtered)
  }

  async getGlobalSummary(since?: number): Promise<UsageSummary> {
    return this.getSummary(undefined, since)
  }

  async pruneOlderThan(timestamp: number): Promise<number> {
    const before = this.records.length
    this.records = this.records.filter((r) => r.createdAt >= timestamp)
    const pruned = before - this.records.length
    await this.flush()
    return pruned
  }

  private async flush(): Promise<void> {
    try {
      const data = this.records.map((r) => JSON.stringify(r)).join("\n") + "\n"
      await writeFile(this.path, data)
    } catch (err) {
      console.error("Failed to flush usage records:", err)
    }
  }

  private summarize(records: UsageRecord[]): UsageSummary {
    const byModel: Record<string, { requests: number; promptTokens: number; completionTokens: number; cost: number }> = {}
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalCost = 0

    for (const r of records) {
      totalPromptTokens += r.promptTokens
      totalCompletionTokens += r.completionTokens
      totalCost += r.cost
      if (!byModel[r.model]) {
        byModel[r.model] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 }
      }
      byModel[r.model].requests++
      byModel[r.model].promptTokens += r.promptTokens
      byModel[r.model].completionTokens += r.completionTokens
      byModel[r.model].cost += r.cost
    }

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalCost,
      requestCount: records.length,
      byModel,
    }
  }
}
