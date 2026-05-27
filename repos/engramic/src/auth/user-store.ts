import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import type { Account, ProviderConfig } from "../types.js"

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"
const ACCOUNTS_FILE = "accounts.json"

export class UserStore {
  private accounts = new Map<string, Account>()
  private path: string

  constructor() {
    this.path = join(DATA_DIR, ACCOUNTS_FILE)
    mkdir(DATA_DIR, { recursive: true })
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) return
    try {
      const raw = await readFile(this.path, "utf-8")
      const data = JSON.parse(raw) as Account[]
      for (const a of data) {
        this.accounts.set(a.token, a)
      }
    } catch (err) {
      console.error("Failed to load accounts:", err)
    }

    const testUserId = process.env.TEST_USER_ID
    if (testUserId && !this.accounts.has(testUserId)) {
      const apiKey = process.env.ENGRA_OPENAI_API_KEY || ""
      const baseUrl = process.env.ENGRA_OPENAI_BASE_URL || "https://api.openai.com/v1"
      const defaultModel = process.env.ENGRA_DEFAULT_MODEL || "gpt-4o"

      const account: Account = {
        token: testUserId,
        providers: [
          {
            label: "default",
            providerType: process.env.ENGRA_PROVIDER_TYPE || "openai",
            apiKey,
            baseUrl,
            defaultModel,
          },
        ],
        createdAt: Date.now(),
      }
      this.accounts.set(testUserId, account)
      await this.save()
      console.log(`Auto-created test account for TEST_USER_ID=${testUserId}`)
    }
  }

  async save(): Promise<void> {
    const data = Array.from(this.accounts.values())
    await writeFile(this.path, JSON.stringify(data, null, 2))
  }

  private generateToken(): string {
    const hash = createHash("sha256").update(randomBytes(32)).digest("hex")
    return `eng_${hash.slice(0, 24)}`
  }

  getAccount(token: string): Account | undefined {
    return this.accounts.get(token)
  }

  createAccount(firstProvider: ProviderConfig): Account {
    const token = this.generateToken()
    const account: Account = {
      token,
      providers: [firstProvider],
      createdAt: Date.now(),
    }
    this.accounts.set(token, account)
    this.save()
    return account
  }

  addProvider(token: string, config: ProviderConfig): Account | null {
    const account = this.accounts.get(token)
    if (!account) return null

    const existing = account.providers.findIndex((p) => p.label === config.label)
    if (existing >= 0) {
      account.providers[existing] = config
    } else {
      account.providers.push(config)
    }

    this.save()
    return account
  }

  getProviderByLabel(token: string, label: string): ProviderConfig | undefined {
    const account = this.accounts.get(token)
    if (!account) return undefined
    return account.providers.find((p) => p.label === label)
  }

  resolveProvider(token: string, modelName: string): { provider: ProviderConfig; model: string } | null {
    const account = this.accounts.get(token)
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

  listModels(token: string): Array<{ id: string; owned_by: string }> {
    const account = this.accounts.get(token)
    if (!account) return []

    const models: Array<{ id: string; owned_by: string }> = []
    for (const p of account.providers) {
      models.push({
        id: `${p.label}/${p.defaultModel}`,
        owned_by: p.providerType,
      })
    }
    return models
  }

  removeProvider(token: string, label: string): boolean {
    const account = this.accounts.get(token)
    if (!account) return false
    const before = account.providers.length
    account.providers = account.providers.filter((p) => p.label !== label)
    if (account.providers.length === before) return false
    this.save()
    return true
  }
}
