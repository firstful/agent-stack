import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import type { Account, Profile, ProviderConfig } from "../types.js"

const DATA_DIR = process.env.ENGRA_DATA_DIR || "/data"
const ACCOUNTS_FILE = "accounts.json"

export interface IUserStore {
  load(): Promise<void>
  save(): Promise<void>
  getAccount(token: string): Promise<Account | undefined>
  createAccount(firstProvider: ProviderConfig): Promise<Account>
  addProvider(token: string, config: ProviderConfig): Promise<Account | null>
  getProviderByLabel(token: string, label: string): Promise<ProviderConfig | undefined>
  resolveProvider(token: string, modelName: string): Promise<{ provider: ProviderConfig; model: string } | null>
  listModels(token: string): Promise<Array<{ id: string; owned_by: string }>>
  removeProvider(token: string, label: string): Promise<boolean>
  getAccountByProfileToken(profileToken: string): Promise<Account | undefined>
  getProfile(accountToken: string, profileId: string): Promise<Profile | undefined>
  createProfile(accountToken: string, profile: Omit<Profile, "id" | "authToken" | "createdAt">): Promise<Profile>
  updateProfile(accountToken: string, profileId: string, updates: Partial<Profile>): Promise<Profile | undefined>
  deleteProfile(accountToken: string, profileId: string): Promise<boolean>
  regenerateProfileToken(accountToken: string, profileId: string): Promise<string | undefined>
}

export class UserStore implements IUserStore {
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
        profiles: [],
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

  async getAccount(token: string): Promise<Account | undefined> {
    return this.accounts.get(token)
  }

  async createAccount(firstProvider: ProviderConfig): Promise<Account> {
    const token = this.generateToken()
    const account: Account = {
      token,
      providers: [firstProvider],
      profiles: [],
      createdAt: Date.now(),
    }
    this.accounts.set(token, account)
    await this.save()
    return account
  }

  async addProvider(token: string, config: ProviderConfig): Promise<Account | null> {
    const account = this.accounts.get(token)
    if (!account) return null

    const existing = account.providers.findIndex((p) => p.label === config.label)
    if (existing >= 0) {
      account.providers[existing] = config
    } else {
      account.providers.push(config)
    }

    await this.save()
    return account
  }

  async getProviderByLabel(token: string, label: string): Promise<ProviderConfig | undefined> {
    const account = this.accounts.get(token)
    if (!account) return undefined
    return account.providers.find((p) => p.label === label)
  }

  async resolveProvider(token: string, modelName: string): Promise<{ provider: ProviderConfig; model: string } | null> {
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

  async listModels(token: string): Promise<Array<{ id: string; owned_by: string }>> {
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

  async removeProvider(token: string, label: string): Promise<boolean> {
    const account = this.accounts.get(token)
    if (!account) return false
    const before = account.providers.length
    account.providers = account.providers.filter((p) => p.label !== label)
    if (account.providers.length === before) return false
    await this.save()
    return true
  }

  async getAccountByProfileToken(profileToken: string): Promise<Account | undefined> {
    for (const account of this.accounts.values()) {
      if (account.profiles?.some((p) => p.authToken === profileToken)) {
        return account
      }
    }
    return undefined
  }

  async getProfile(accountToken: string, profileId: string): Promise<Profile | undefined> {
    const account = this.accounts.get(accountToken)
    if (!account) return undefined
    return account.profiles?.find((p) => p.id === profileId)
  }

  async createProfile(accountToken: string, input: Omit<Profile, "id" | "authToken" | "createdAt">): Promise<Profile> {
    const account = this.accounts.get(accountToken)
    if (!account) throw new Error("Account not found")

    if (!account.profiles) account.profiles = []

    const profile: Profile = {
      ...input,
      id: `prof_${this.generateToken()}`,
      authToken: `p_${this.generateToken()}`,
      createdAt: Date.now(),
    }
    account.profiles.push(profile)
    await this.save()
    return profile
  }

  async updateProfile(accountToken: string, profileId: string, updates: Partial<Profile>): Promise<Profile | undefined> {
    const account = this.accounts.get(accountToken)
    if (!account) return undefined
    const idx = account.profiles?.findIndex((p) => p.id === profileId) ?? -1
    if (idx === -1) return undefined
    account.profiles[idx] = { ...account.profiles[idx], ...updates }
    await this.save()
    return account.profiles[idx]
  }

  async deleteProfile(accountToken: string, profileId: string): Promise<boolean> {
    const account = this.accounts.get(accountToken)
    if (!account) return false
    const before = account.profiles?.length ?? 0
    account.profiles = (account.profiles || []).filter((p) => p.id !== profileId)
    if (account.profiles.length === before) return false
    await this.save()
    return true
  }

  async regenerateProfileToken(accountToken: string, profileId: string): Promise<string | undefined> {
    const account = this.accounts.get(accountToken)
    if (!account) return undefined
    const profile = account.profiles?.find((p) => p.id === profileId)
    if (!profile) return undefined
    profile.authToken = `p_${this.generateToken()}`
    await this.save()
    return profile.authToken
  }
}
