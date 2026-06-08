import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface BackendConfig {
  name: string
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface StoredConfig {
  activeBackend: string
  backends: BackendConfig[]
}

function configDir(): string {
  return join(homedir(), '.config', 'engramic')
}

function configPath(): string {
  return join(configDir(), 'credentials.json')
}

export function loadBackends(): StoredConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    return JSON.parse(raw) as StoredConfig
  } catch {
    return { activeBackend: '', backends: [] }
  }
}

export function saveBackends(config: StoredConfig): void {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2))
}

export function getActiveBackend(): BackendConfig | undefined {
  const stored = loadBackends()
  if (!stored.activeBackend) return stored.backends[0]
  return stored.backends.find(b => b.name === stored.activeBackend)
}

export function cmdAuthConnect(args: string[]): void {
  // engramic auth connect [name] --key <key> [--url <url>] [--model <model>]
  const name = args[0] || 'default'
  const key = extractArg(args, '--key', '-k') || process.env.ENGRAMIC_API_KEY || ''
  const baseUrl = extractArg(args, '--url', '-u') || process.env.ENGRAMIC_BASE_URL || 'https://api.openai.com/v1'
  const defaultModel = extractArg(args, '--model', '-m') || 'gpt-4o'

  if (!key) {
    console.error('Error: API key required (--key <key> or ENGRAMIC_API_KEY env var)')
    process.exit(1)
  }

  const stored = loadBackends()
  const idx = stored.backends.findIndex(b => b.name === name)
  const backend: BackendConfig = { name, apiKey: key, baseUrl, defaultModel }

  if (idx >= 0) {
    stored.backends[idx] = backend
  } else {
    stored.backends.push(backend)
  }
  stored.activeBackend = name
  saveBackends(stored)

  console.log(`  \u2713 Connected backend "${name}"`)
  console.log(`    URL   : ${baseUrl}`)
  console.log(`    Model : ${defaultModel}`)
  console.log(`    Config: ${configPath()}`)
}

export function cmdAuthList(): void {
  const stored = loadBackends()
  if (stored.backends.length === 0) {
    console.log('  No backends configured. Run: engramic auth connect')
    return
  }
  console.log('  Configured backends:')
  for (const b of stored.backends) {
    const active = b.name === stored.activeBackend ? ' <-- active' : ''
    console.log(`    - ${b.name} (${b.baseUrl}, ${b.defaultModel})${active}`)
  }
  console.log(`    Config: ${configPath()}`)
}

function extractArg(args: string[], ...flags: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) return args[i + 1]
  }
  return undefined
}
