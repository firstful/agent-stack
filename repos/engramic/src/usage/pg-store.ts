import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import type { UsageRecord, UsageSummary } from "../types.js"
import type { IUsageStore } from "./store.js"
import { PricingEngine } from "./pricing.js"

export class PgUsageStore implements IUsageStore {
  private pool: Pool
  private pricing: PricingEngine

  constructor(pricing?: PricingEngine, pool?: Pool) {
    this.pool = pool || new Pool({ connectionString: process.env.ENGRA_DATABASE_URL })
    this.pricing = pricing || new PricingEngine()
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS usage_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES accounts(token) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_label TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        created_at BIGINT NOT NULL
      )
    `)
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_log(user_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_usage_conversation_id ON usage_log(conversation_id)")
    await this.pool.query("CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_log(created_at)")
    await this.pool.query("ALTER TABLE usage_log ENABLE ROW LEVEL SECURITY")
    await this.pool.query("DROP POLICY IF EXISTS usage_log_user_isolation ON usage_log")
    await this.pool.query(`CREATE POLICY usage_log_user_isolation ON usage_log USING (user_id = current_setting('app.user_id', true)::TEXT)`)
  }

  async record(usage: UsageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_log (id, user_id, conversation_id, model, provider_label, prompt_tokens, completion_tokens, total_tokens, cost, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [usage.id, usage.userId, usage.conversationId, usage.model, usage.providerLabel,
       usage.promptTokens, usage.completionTokens, usage.totalTokens, usage.cost, usage.createdAt],
    )
  }

  async getByUser(userId: string, since?: number): Promise<UsageRecord[]> {
    const sinceTs = since || 0
    const r = await this.pool.query(
      "SELECT * FROM usage_log WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at DESC",
      [userId, sinceTs],
    )
    return r.rows.map(this.rowToRecord)
  }

  async getByConversation(convId: string): Promise<UsageRecord[]> {
    const r = await this.pool.query(
      "SELECT * FROM usage_log WHERE conversation_id = $1 ORDER BY created_at DESC",
      [convId],
    )
    return r.rows.map(this.rowToRecord)
  }

  async getSummary(userId?: string, since?: number): Promise<UsageSummary> {
    const sinceTs = since || 0
    let r
    if (userId) {
      r = await this.pool.query(
        "SELECT * FROM usage_log WHERE user_id = $1 AND created_at >= $2",
        [userId, sinceTs],
      )
    } else {
      r = await this.pool.query(
        "SELECT * FROM usage_log WHERE created_at >= $1",
        [sinceTs],
      )
    }
    const records = r.rows.map(this.rowToRecord)
    return this.summarize(records)
  }

  async getGlobalSummary(since?: number): Promise<UsageSummary> {
    return this.getSummary(undefined, since)
  }

  async pruneOlderThan(timestamp: number): Promise<number> {
    const r = await this.pool.query("DELETE FROM usage_log WHERE created_at < $1", [timestamp])
    return r.rowCount || 0
  }

  private rowToRecord(row: Record<string, unknown>): UsageRecord {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      conversationId: row.conversation_id as string,
      model: row.model as string,
      providerLabel: row.provider_label as string,
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cost: Number(row.cost),
      createdAt: Number(row.created_at),
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
