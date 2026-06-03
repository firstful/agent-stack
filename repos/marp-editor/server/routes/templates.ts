import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

const TEMPLATES_DIR = path.join(process.cwd(), 'server', 'data', 'templates')
const MANIFEST_PATH = path.join(TEMPLATES_DIR, 'manifest.json')

interface TemplateEntry {
  id: string
  name: string
  description: string
  category: string
  slideCount: number
  file: string
  tags: string[]
}

interface Manifest {
  templates: TemplateEntry[]
}

let manifestCache: Manifest | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 10_000

function loadManifest(): Manifest {
  const mtime = fs.statSync(MANIFEST_PATH).mtimeMs
  if (manifestCache && mtime - cacheTimestamp < CACHE_TTL_MS) {
    return manifestCache
  }
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8')
  manifestCache = JSON.parse(raw) as Manifest
  cacheTimestamp = Date.now()
  return manifestCache
}

// List all templates
router.get('/templates', (_req: Request, res: Response) => {
  try {
    const manifest = loadManifest()
    res.json(manifest.templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      slideCount: t.slideCount,
      tags: t.tags,
    })))
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to list templates'
    res.status(500).json({ error })
  }
})

// Get template content by ID
router.get('/templates/:id', (req: Request, res: Response) => {
  try {
    const manifest = loadManifest()
    const entry = manifest.templates.find((t) => t.id === req.params.id)
    if (!entry) {
      res.status(404).json({ error: `Template '${req.params.id}' not found` })
      return
    }

    const filePath = path.join(TEMPLATES_DIR, entry.file)

    // Security: ensure the resolved path is within TEMPLATES_DIR
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(TEMPLATES_DIR))) {
      res.status(403).json({ error: 'Invalid template path' })
      return
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: `Template file '${entry.file}' not found` })
      return
    }

    const markdown = fs.readFileSync(resolved, 'utf-8')

    res.json({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      slideCount: entry.slideCount,
      tags: entry.tags,
      markdown,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to get template'
    res.status(500).json({ error })
  }
})

export default router
