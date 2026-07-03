import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const PORT = parseInt(process.env.PORT || '3500')
const DATA_DIR = '/data'
const KEY_FILE = path.join(DATA_DIR, '.vault-key')
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json')
const VAULT_PASSWORD = process.env.VAULT_PASSWORD || 'changeme'

// ── Encryption key (auto-generated, persisted in volume) ──────────

function loadOrCreateKey(): Buffer {
  if (process.env.VAULT_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.VAULT_ENCRYPTION_KEY).digest()
  }
  try {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
  } catch {
    const key = crypto.randomBytes(32)
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(KEY_FILE, key.toString('hex'), 'utf8')
    fs.chmodSync(KEY_FILE, 0o600)
    console.log('[vault] generated new encryption key')
    return key
  }
}

const ENCRYPTION_KEY = loadOrCreateKey()
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  let enc = cipher.update(plaintext, 'utf8', 'hex')
  enc += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return iv.toString('hex') + ':' + tag + ':' + enc
}

function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Invalid payload')
  const iv = Buffer.from(parts[0], 'hex')
  const tag = Buffer.from(parts[1], 'hex')
  const enc = parts[2]
  const d = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  d.setAuthTag(tag)
  let out = d.update(enc, 'hex', 'utf8')
  out += d.final('utf8')
  return out
}

// ── Secrets store (single JSON file, values encrypted) ────────────

interface SecretEntry {
  value: string   // encrypted
  scopes: string[]  // service names
}

interface SecretsFile {
  [key: string]: SecretEntry
}

function loadStore(): SecretsFile {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveStore(store: SecretsFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(store, null, 2), 'utf8')
  fs.chmodSync(SECRETS_FILE, 0o600)
}

function getSecret(key: string): { value: string; scopes: string[] } | null {
  const store = loadStore()
  const entry = store[key]
  if (!entry) return null
  return { value: decrypt(entry.value), scopes: entry.scopes }
}

function setSecret(key: string, value: string, scopes: string[]): void {
  const store = loadStore()
  store[key] = { value: encrypt(value), scopes }
  saveStore(store)
}

function deleteSecret(key: string): boolean {
  const store = loadStore()
  if (!store[key]) return false
  delete store[key]
  saveStore(store)
  return true
}

function secretsForService(service: string): Record<string, string> {
  const store = loadStore()
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(store)) {
    if (entry.scopes.includes(service)) {
      result[key] = decrypt(entry.value)
    }
  }
  return result
}

// ── Auth ─────────────────────────────────────────────────────────

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== VAULT_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// ── App ───────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// List all secrets (values masked)
app.get('/api/secrets', requireAuth, (_req, res) => {
  const store = loadStore()
  const result = Object.entries(store).map(([key, entry]) => ({
    key,
    scopes: entry.scopes,
    set: true,
  }))
  res.json(result)
})

// Get a single secret
app.get('/api/secrets/:key', requireAuth, (req, res) => {
  const secret = getSecret(req.params.key)
  if (!secret) { res.status(404).json({ error: 'Not found' }); return }
  res.json({ key: req.params.key, value: secret.value, scopes: secret.scopes })
})

function validateKey(key: string): boolean {
  return /^[A-Z_]+$/.test(key)
}

// Create or update a secret
app.put('/api/secrets/:key', requireAuth, (req, res) => {
  const { key } = req.params
  if (!validateKey(key)) {
    res.status(400).json({ error: 'Key must be uppercase letters and underscores only' })
    return
  }
  const { value, scopes, keepValue } = req.body
  if (!Array.isArray(scopes)) {
    res.status(400).json({ error: 'scopes[] is required' })
    return
  }
  if (keepValue) {
    // Update scopes only, preserve existing encrypted value
    const store = loadStore()
    if (!store[key]) { res.status(404).json({ error: 'Not found' }); return }
    store[key].scopes = scopes
    saveStore(store)
    res.json({ ok: true })
    return
  }
  if (value === undefined) {
    res.status(400).json({ error: 'value is required' })
    return
  }
  setSecret(key, String(value), scopes)
  res.json({ ok: true })
})

// Delete a secret
app.delete('/api/secrets/:key', requireAuth, (req, res) => {
  if (deleteSecret(req.params.key)) res.json({ ok: true })
  else res.status(404).json({ error: 'Not found' })
})

// Controller endpoint: plaintext secrets for a specific service
app.get('/api/secrets/plain/:service', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token !== VAULT_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const { service } = req.params
  res.json({ name: service, secrets: secretsForService(service) })
})

// ── Service discovery from controller ────────────────────────────

const CONTROLLER_URL = process.env.CONTROLLER_URL || 'http://host.containers.internal:80'

let cachedServices: string[] = []
let lastServiceFetch = 0
const SERVICE_CACHE_TTL = 60_000  // 1 minute

async function fetchServicesFromController(): Promise<string[]> {
  try {
    const resp = await fetch(`${CONTROLLER_URL}/status`, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    const names = Object.keys(data.services || {})
    console.log(`[vault] discovered ${names.length} services from controller`)
    return names.sort()
  } catch (err) {
    console.warn(`[vault] controller unreachable (${err}), falling back to secrets-based discovery`)
    // Fallback: extract service names from existing secrets' scopes
    const store = loadStore()
    const scopeSet = new Set<string>()
    for (const entry of Object.values(store)) {
      for (const s of entry.scopes) scopeSet.add(s)
    }
    return Array.from(scopeSet).sort()
  }
}

function getServices(): string[] {
  const now = Date.now()
  if (now - lastServiceFetch > SERVICE_CACHE_TTL) {
    // Fire-and-forget refresh
    fetchServicesFromController().then(svcs => {
      cachedServices = svcs
      lastServiceFetch = now
    }).catch(() => {})
  }
  return cachedServices
}

// Warm the cache on startup
fetchServicesFromController().then(svcs => {
  cachedServices = svcs
  lastServiceFetch = Date.now()
  console.log(`[vault] initial service list: ${svcs.join(', ')}`)
})

// Endpoint for frontend to get service names
app.get('/api/services', (_req, res) => {
  const svcs = getServices()
  res.json({ services: svcs, source: svcs.length === 0 ? 'fallback' : 'controller' })
})

// Frontend
app.use(express.static(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public')))

app.listen(PORT, () => {
  console.log(`Vault running on http://localhost:${PORT}`)
})
