import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { requireSession } from '../session'

const router = Router()

// List presentations
router.get('/', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId

  const rows = db.prepare(`
    SELECT p.id, p.title, p.created_at, p.updated_at,
           vn.version, vn.parent_version, vn.is_fork, vn.fork_label
    FROM presentations p
    JOIN version_nodes vn ON vn.presentation_id = p.id
    WHERE p.user_id = ?
    AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
    ORDER BY p.updated_at DESC
  `).all(userId)

  res.json(rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })))
})

// Create presentation
router.post('/', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId
  const { title, markdown, css } = req.body

  const presId = uuidv4()
  const now = Date.now()

  db.prepare(`
    INSERT INTO presentations (id, title, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(presId, title || 'Untitled', userId, now, now)

  const versionId = uuidv4()
  db.prepare(`
    INSERT INTO version_nodes (id, presentation_id, version, parent_version, markdown, css, title, created_at)
    VALUES (?, ?, 1, NULL, ?, ?, ?, ?)
  `).run(versionId, presId, markdown, css || '', title || 'Untitled', now)

  res.status(201).json({
    id: presId,
    title: title || 'Untitled',
    version: 1,
    createdAt: now,
    updatedAt: now,
  })
})

// Get presentation
router.get('/:id', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId
  const { id } = req.params

  const pres = db.prepare(`
    SELECT p.id, p.title, p.created_at, p.updated_at,
           vn.version, vn.parent_version, vn.markdown, vn.css, vn.theme, vn.is_fork, vn.fork_label
    FROM presentations p
    JOIN version_nodes vn ON vn.presentation_id = p.id
    WHERE p.id = ? AND p.user_id = ?
    AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
  `).get(id, userId) as any

  if (!pres) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({
    id: pres.id,
    title: pres.title,
    markdown: pres.markdown,
    css: pres.css,
    theme: pres.theme,
    version: pres.version,
    parentId: pres.parent_version,
    forkOrigin: pres.is_fork ? `forked from v${pres.parent_version}` : null,
    createdAt: pres.created_at,
    updatedAt: pres.updated_at,
  })
})

// Update presentation (create new version)
router.put('/:id', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId
  const { id } = req.params
  const { markdown, css } = req.body

  const pres = db.prepare('SELECT * FROM presentations WHERE id = ? AND user_id = ?').get(id, userId) as any
  if (!pres) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const latestVersion = db.prepare(
    'SELECT MAX(version) as maxVer FROM version_nodes WHERE presentation_id = ?'
  ).get(id) as any
  const newVersion = (latestVersion?.maxVer || 0) + 1
  const now = Date.now()
  const versionId = uuidv4()

  db.prepare(`
    INSERT INTO version_nodes (id, presentation_id, version, parent_version, markdown, css, title, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, id, newVersion, newVersion - 1, markdown, css || '', pres.title, now)

  db.prepare('UPDATE presentations SET updated_at = ? WHERE id = ?').run(now, id)

  res.json({
    id,
    title: pres.title,
    version: newVersion,
    updatedAt: now,
  })
})

// Fork presentation
router.post('/:id/fork', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId
  const { id } = req.params
  const { version } = req.body

  const sourceVersion = db.prepare(`
    SELECT * FROM version_nodes WHERE presentation_id = ? AND version = ?
  `).get(id, version) as any

  if (!sourceVersion) {
    res.status(404).json({ error: 'Source version not found' })
    return
  }

  const newPresId = uuidv4()
  const now = Date.now()
  const versionId = uuidv4()

  db.prepare(`
    INSERT INTO presentations (id, title, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(newPresId, `${sourceVersion.title} (fork)`, userId, now, now)

  db.prepare(`
    INSERT INTO version_nodes (id, presentation_id, version, parent_version, markdown, css, theme, title, created_at, is_fork, fork_label)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(versionId, newPresId, version, sourceVersion.markdown, sourceVersion.css, sourceVersion.theme, `${sourceVersion.title} (fork)`, now, `forked from v${version}`)

  res.status(201).json({
    id: newPresId,
    title: `${sourceVersion.title} (fork)`,
    version: 1,
    parentId: version,
    forkOrigin: `forked from v${version}`,
    createdAt: now,
    updatedAt: now,
  })
})

// Get version tree
router.get('/:id/versions', requireSession, (req: Request, res: Response) => {
  const db = getDb()
  const userId = (req as any).userId
  const { id } = req.params

  const pres = db.prepare('SELECT * FROM presentations WHERE id = ? AND user_id = ?').get(id, userId)
  if (!pres) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const versions = db.prepare(`
    SELECT * FROM version_nodes WHERE presentation_id = ? ORDER BY version ASC
  `).all(id)

  res.json(versions.map((v: any) => ({
    id: v.id,
    presentationId: v.presentation_id,
    version: v.version,
    parentVersion: v.parent_version,
    markdown: v.markdown,
    css: v.css,
    title: v.title,
    createdAt: v.created_at,
    isFork: !!v.is_fork,
    forkLabel: v.fork_label,
  })))
})

export default router
