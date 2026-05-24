import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../db'
import { requireSession } from '../session'

const router = Router()

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

// POST /api/presentations/:id/share — create a share link
router.post('/presentations/:id/share', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId
    const { id } = req.params
    const { expiresIn } = req.body // seconds, null = never

    const pres = db.prepare('SELECT id FROM presentations WHERE id = ? AND user_id = ?').get(id, userId)
    if (!pres) {
      res.status(404).json({ error: 'Presentation not found' })
      return
    }

    const linkId = uuidv4()
    const token = generateToken()
    const now = Date.now()
    const expiresAt = typeof expiresIn === 'number' && expiresIn > 0 ? now + expiresIn * 1000 : null

    db.prepare(`
      INSERT INTO share_links (id, presentation_id, token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(linkId, id, token, now, expiresAt)

    res.status(201).json({
      id: linkId,
      token,
      url: `/share/${token}`,
      createdAt: now,
      expiresAt,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to create share link'
    res.status(500).json({ error })
  }
})

// GET /api/presentations/:id/shares — list share links for a presentation
router.get('/presentations/:id/shares', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId
    const { id } = req.params

    const pres = db.prepare('SELECT id FROM presentations WHERE id = ? AND user_id = ?').get(id, userId)
    if (!pres) {
      res.status(404).json({ error: 'Presentation not found' })
      return
    }

    const links = db.prepare(`
      SELECT id, token, created_at, expires_at, is_active
      FROM share_links
      WHERE presentation_id = ?
      ORDER BY created_at DESC
    `).all(id)

    res.json(links.map((l: any) => ({
      id: l.id,
      token: l.token,
      url: `/share/${l.token}`,
      createdAt: l.created_at,
      expiresAt: l.expires_at,
      isActive: !!l.is_active,
      expired: l.expires_at ? Date.now() > l.expires_at : false,
    })))
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to list shares'
    res.status(500).json({ error })
  }
})

// DELETE /api/presentations/:id/share/:linkId — revoke a share link
router.delete('/presentations/:id/share/:linkId', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId
    const { id, linkId } = req.params

    const pres = db.prepare('SELECT id FROM presentations WHERE id = ? AND user_id = ?').get(id, userId)
    if (!pres) {
      res.status(404).json({ error: 'Presentation not found' })
      return
    }

    db.prepare('UPDATE share_links SET is_active = 0 WHERE id = ? AND presentation_id = ?').run(linkId, id)
    res.json({ ok: true })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to revoke share link'
    res.status(500).json({ error })
  }
})

// GET /api/share/:token — view a shared presentation (public, no auth)
router.get('/share/:token', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { token } = req.params

    const link = db.prepare(`
      SELECT sl.id, sl.presentation_id, sl.expires_at, sl.is_active,
             p.title, vn.markdown, vn.css
      FROM share_links sl
      JOIN presentations p ON p.id = sl.presentation_id
      JOIN version_nodes vn ON vn.presentation_id = p.id
      WHERE sl.token = ?
      AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
    `).get(token) as any

    if (!link) {
      res.status(404).json({ error: 'Share link not found' })
      return
    }

    if (!link.is_active) {
      res.status(410).json({ error: 'Share link has been revoked' })
      return
    }

    if (link.expires_at && Date.now() > link.expires_at) {
      res.status(410).json({ error: 'Share link has expired' })
      return
    }

    res.json({
      title: link.title,
      markdown: link.markdown,
      css: link.css,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to load shared presentation'
    res.status(500).json({ error })
  }
})

export default router
