import { Pool } from "pg"
import { createHash, randomBytes } from "node:crypto"
import type { Account, ProviderConfig } from "../types.js"

export class PgUserStore {
  private pool: Pool

  constructor(pool?: Pool) {
    this.pool = pool || new Pool({ connectionString: process.env.ENGRA_DATABASE_URL })
  }

  async load(): Promise<void> {
    const testUserId = process.env.TEST_USER_ID
    if (!testUserId) return
    const existing = await this.getAccount(testUserId)
    if (existing) return

    const apiKey = process.env.ENGRA_OPENAI_API_KEY || ""
    const baseUrl = process.env.ENGRA_OPENAI_BASE_URL || "https://api.openai.com/v1"
    const defaultModel = process.env.ENGRA_DEFAULT_MODEL || "gpt-4o"

    await this.pool.query(
      "INSERT INTO accounts (token, providers, created_at) VALUES ($1, $2::jsonb, $3) ON CONFLICT (token) DO NOTHING",
      [testUserId, JSON.stringify([{
        label: "default",
        providerType: process.env.ENGRA_PROVIDER_TYPE || "openai",
        apiKey,
        baseUrl,
        defaultModel,
      }]), Date.now()],
    )
    console.log(`Auto-created test account for TEST_USER_ID=${testUserId}`)
  }

  async save(): Promise<void> {}

  private generateToken(): string {
    const hash = createHash("sha256").update(randomBytes(32)).digest("hex")
    return `eng_${hash.slice(0, 24)}`
  }

  async getAccount(token: string): Promise<Account | undefined> {
    const r = await this.pool.query("SELECT token, providers, created_at FROM accounts WHERE token = $1", [token])
    if (!r.rows.length) return undefined
    const row = r.rows[0]
    return { token: row.token, providers: row.providers, createdAt: row.created_at }
  }

  async createAccount(firstProvider: ProviderConfig): Promise<Account> {
    const token = this.generateToken()
    const createdAt = Date.now()
    await this.pool.query(
      "INSERT INTO accounts (token, providers, created_at) VALUES ($1, $2::jsonb, $3)",
      [token, JSON.stringify([firstProvider]), createdAt],
    )
    return { token, providers: [firstProvider], createdAt }
  }

  async addProvider(token: string, config: ProviderConfig): Promise<Account | null> {
    const account = await this.getAccount(token)
    if (!account) return null
    const existing = account.providers.findIndex((p) => p.label === config.label)
    if (existing >= 0) {
      account.providers[existing] = config
    } else {
      account.providers.push(config)
    }
    await this.pool.query("UPDATE accounts SET providers = $1::jsonb WHERE token = $2",
      [JSON.stringify(account.providers), token])
    return account
  }

  async getProviderByLabel(token: string, label: string): Promise<ProviderConfig | undefined> {
    const account = await this.getAccount(token)
    if (!account) return undefined
    return account.providers.find((p) => p.label === label)
  }

  async resolveProvider(token: string, modelName: string): Promise<{ provider: ProviderConfig; model: string } | null> {
    const account = await this.getAccount(token)
    if (!account) return null

    const slashIdx = modelName.indexOf("/")
    if (slashIdx === -1) {
      if (account.providers.length === 1) {
        return { provider: account.providers[0], model: modelName }
      }
      return null
    }

    const label = modelName.slice(0, slashIdx)
    const model = modelName.slice(slashIdx + 1)
    const provider = account.providers.find((p) => p.label === label)
    if (!provider) return null

    return { provider, model }
  }

  async listModels(token: string): Promise<Array<{ id: string; owned_by: string }>> {
    const account = await this.getAccount(token)
    if (!account) return []

    return account.providers.map((p) => ({
      id: `${p.label}/${p.defaultModel}`,
      owned_by: p.providerType,
    }))
  }

  async removeProvider(token: string, label: string): Promise<boolean> {
    const account = await this.getAccount(token)
    if (!account) return false
    const before = account.providers.length
    account.providers = account.providers.filter((p) => p.label !== label)
    if (account.providers.length === before) return false
    await this.pool.query("UPDATE accounts SET providers = $1::jsonb WHERE token = $2",
      [JSON.stringify(account.providers), token])
    return true
  }
}
