import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { requireSession } from '../session'
import { scrapeTheme, scrapeFavicon, paletteToCss, paletteToMarpTheme, applyPaletteToMarkdown, invalidateCachedTheme } from '../theme-scraper'
import type { ScrapedPalette } from '../theme-scraper'

const router = Router()

// Scrape theme from URL (public)
router.post('/scrape-theme', async (req: Request, res: Response) => {
  try {
    const { url } = req.body

    if (!url) {
      res.status(400).json({ error: 'URL is required' })
      return
    }

    const [palette, favicon] = await Promise.all([
      scrapeTheme(url),
      scrapeFavicon(url).catch(() => null),
    ])

    res.json({ palette, favicon })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Theme scraping failed'
    res.status(500).json({ error })
  }
})

// Apply palette to markdown (public)
router.post('/apply-palette', (req: Request, res: Response) => {
  try {
    const { markdown, palette } = req.body as { markdown: string; palette: ScrapedPalette }

    if (!markdown || !palette) {
      res.status(400).json({ error: 'Markdown and palette are required' })
      return
    }

    const newMarkdown = applyPaletteToMarkdown(markdown, palette)
    const css = paletteToCss(palette)

    res.json({
      markdown: newMarkdown,
      css,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to apply palette'
    res.status(500).json({ error })
  }
})

// List themes — user's own themes first, then public
router.get('/themes', async (req: Request, res: Response) => {
  try {
    const db = getDb()
    let userId: string | null = null
    try {
      const { auth } = await import('../auth')
      const session = await auth.api.getSession({ headers: (await import('../auth')).fromNodeHeaders(req.headers) })
      if (session) userId = session.user.id
    } catch {}
    if (userId) {
      const themes = db.prepare('SELECT * FROM theme_palettes WHERE user_id IS NULL OR user_id = ? ORDER BY user_id DESC, created_at DESC').all(userId)
      res.json(themes.map((t: any) => ({
        id: t.id,
        name: t.name,
        sourceUrl: t.source_url,
        ...JSON.parse(t.palette_json),
      })))
    } else {
      const themes = db.prepare('SELECT * FROM theme_palettes WHERE user_id IS NULL ORDER BY created_at DESC').all()
      res.json(themes.map((t: any) => ({
        id: t.id,
        name: t.name,
        sourceUrl: t.source_url,
        ...JSON.parse(t.palette_json),
      })))
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to list themes'
    res.status(500).json({ error })
  }
})

// Delete theme (own only)
router.delete('/themes/:id', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { id } = req.params
    const userId = (req as any).userId
    const result = db.prepare('DELETE FROM theme_palettes WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
    if (result.changes === 0) {
      res.status(404).json({ error: 'Not found or unauthorized' })
      return
    }
    res.json({ ok: true })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to delete theme'
    res.status(500).json({ error })
  }
})

// Save theme (scoped to user)
router.post('/themes', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId
    const { name, sourceUrl, colors, fonts } = req.body

    const id = uuidv4()
    const now = Date.now()

    db.prepare(`
      INSERT INTO theme_palettes (id, name, source_url, palette_json, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, sourceUrl, JSON.stringify({ colors, fonts }), userId, now)

    res.status(201).json({ id })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to save theme'
    res.status(500).json({ error })
  }
})

export default router
