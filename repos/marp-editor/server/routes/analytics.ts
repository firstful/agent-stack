import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { requireSession } from '../session'

const router = Router()

// ─── Record a view event (public, no auth — called from SharedView) ─────────

router.post('/share/:token/view', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { token } = req.params
    const { viewerId, slideIndex, eventType, sessionId } = req.body

    if (!viewerId) {
      res.status(400).json({ error: 'viewerId is required' })
      return
    }

    // Resolve share link to presentation
    const link = db.prepare(`
      SELECT sl.id AS link_id, sl.presentation_id
      FROM share_links sl
      WHERE sl.token = ? AND sl.is_active = 1
      AND (sl.expires_at IS NULL OR sl.expires_at > ?)
    `).get(token, Date.now()) as any

    if (!link) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }

    const now = Date.now()
    const eventId = uuidv4()
    const idx = typeof slideIndex === 'number' ? slideIndex : 0
    const eType = typeof eventType === 'string' ? eventType : 'view'

    // Insert the view event
    db.prepare(`
      INSERT INTO view_events (id, presentation_id, share_link_id, viewer_id, slide_index, event_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, link.presentation_id, link.link_id, viewerId, idx, eType, now)

    // Upsert view session
    const sid = sessionId || uuidv4()
    const existing = db.prepare(`
      SELECT id FROM view_sessions WHERE id = ? AND viewer_id = ?
    `).get(sid, viewerId) as any

    if (!existing) {
      // Get total slides count for this presentation
      const presData = db.prepare(`
        SELECT markdown FROM version_nodes WHERE presentation_id = ?
        ORDER BY version DESC LIMIT 1
      `).get(link.presentation_id) as any
      const totalSlides = presData ? (presData.markdown.split('\n---\n').length) : 0

      db.prepare(`
        INSERT INTO view_sessions (id, presentation_id, share_link_id, viewer_id, started_at, total_slides, slides_viewed, max_slide_index, last_slide_index, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(sid, link.presentation_id, link.link_id, viewerId, now, totalSlides, idx, idx, now)
    } else {
      db.prepare(`
        UPDATE view_sessions
        SET slides_viewed = MIN(slides_viewed + 1, total_slides),
            max_slide_index = MAX(max_slide_index, ?),
            last_slide_index = ?,
            last_activity_at = ?
        WHERE id = ? AND viewer_id = ?
      `).run(idx, idx, now, sid, viewerId)
    }

    res.json({ ok: true, sessionId: sid, eventId })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to record view'
    res.status(500).json({ error })
  }
})

// ─── End a view session (public) ────────────────────────────────────────────

router.post('/share/:token/view/session/end', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { token } = req.params
    const { viewerId, sessionId } = req.body

    if (!viewerId || !sessionId) {
      res.status(400).json({ error: 'viewerId and sessionId are required' })
      return
    }

    db.prepare(`
      UPDATE view_sessions SET ended_at = ? WHERE id = ? AND viewer_id = ?
    `).run(Date.now(), sessionId, viewerId)

    res.json({ ok: true })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to end session'
    res.status(500).json({ error })
  }
})

// ─── Get analytics for a specific presentation (auth required) ─────────────

router.get('/presentations/:id/analytics', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId
    const { id } = req.params

    // Verify ownership
    const pres = db.prepare('SELECT id, title FROM presentations WHERE id = ? AND user_id = ?').get(id, userId) as any
    if (!pres) {
      res.status(404).json({ error: 'Presentation not found' })
      return
    }

    // Total views (unique view events)
    const totalViews = db.prepare(`
      SELECT COUNT(*) AS count FROM view_events WHERE presentation_id = ?
    `).get(id) as any

    // Unique viewers
    const uniqueViewers = db.prepare(`
      SELECT COUNT(DISTINCT viewer_id) AS count FROM view_sessions WHERE presentation_id = ?
    `).get(id) as any

    // Total sessions
    const totalSessions = db.prepare(`
      SELECT COUNT(*) AS count FROM view_sessions WHERE presentation_id = ?
    `).get(id) as any

    // Average time per slide (from sessions with both start and end times)
    const avgTimePerSlide = db.prepare(`
      SELECT
        CASE
          WHEN SUM(slides_viewed) > 0 THEN CAST(SUM(COALESCE(ended_at, last_activity_at) - started_at) AS REAL) / NULLIF(SUM(slides_viewed), 0)
          ELSE 0
        END AS avg_ms
      FROM view_sessions WHERE presentation_id = ?
    `).get(id) as any

    // Views over time (last 30 days, bucketed by day)
    const viewsOverTime = db.prepare(`
      SELECT
        DATE(created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS views,
        COUNT(DISTINCT viewer_id) AS unique_viewers
      FROM view_events
      WHERE presentation_id = ? AND created_at > ? - 2592000000
      GROUP BY day
      ORDER BY day ASC
    `).all(id, Date.now()) as any[]

    // Slide popularity (how many unique viewers viewed each slide)
    const slidePopularity = db.prepare(`
      SELECT
        slide_index,
        COUNT(*) AS total_views,
        COUNT(DISTINCT viewer_id) AS unique_viewers
      FROM view_events
      WHERE presentation_id = ?
      GROUP BY slide_index
      ORDER BY slide_index ASC
    `).all(id) as any[]

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT
        id, viewer_id, started_at, ended_at, last_activity_at,
        slides_viewed, total_slides, max_slide_index
      FROM view_sessions
      WHERE presentation_id = ?
      ORDER BY started_at DESC
      LIMIT 20
    `).all(id) as any[]

    res.json({
      totalViews: totalViews?.count || 0,
      uniqueViewers: uniqueViewers?.count || 0,
      totalSessions: totalSessions?.count || 0,
      avgTimePerSlideMs: Math.round(avgTimePerSlide?.avg_ms || 0),
      avgTimePerSlideSec: Math.round((avgTimePerSlide?.avg_ms || 0) / 1000),
      viewsOverTime: viewsOverTime.map((r: any) => ({
        day: r.day,
        views: r.views,
        uniqueViewers: r.unique_viewers,
      })),
      slidePopularity: slidePopularity.map((r: any) => ({
        slideIndex: r.slide_index,
        totalViews: r.total_views,
        uniqueViewers: r.unique_viewers,
      })),
      recentSessions: recentSessions.map((r: any) => ({
        id: r.id,
        viewerId: r.viewer_id.slice(0, 8) + '...',
        startedAt: r.started_at,
        endedAt: r.ended_at,
        lastActivityAt: r.last_activity_at,
        slidesViewed: r.slides_viewed,
        totalSlides: r.total_slides,
        maxSlideIndex: r.max_slide_index,
        durationMs: r.ended_at ? r.ended_at - r.started_at : (r.last_activity_at - r.started_at),
      })),
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to load analytics'
    res.status(500).json({ error })
  }
})

// ─── Dashboard: metrics for all user's presentations (auth required) ───────

router.get('/analytics/dashboard', requireSession, (req: Request, res: Response) => {
  try {
    const db = getDb()
    const userId = (req as any).userId

    // Summary across all presentations
    const presentations = db.prepare(`
      SELECT
        p.id, p.title, p.created_at, p.updated_at,
        vn.version
      FROM presentations p
      JOIN version_nodes vn ON vn.presentation_id = p.id
      WHERE p.user_id = ?
      AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
      ORDER BY p.updated_at DESC
    `).all(userId) as any[]

    // Get aggregated metrics for each presentation
    const presMetrics = presentations.map((p: any) => {
      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM view_events WHERE presentation_id = ?) AS total_views,
          (SELECT COUNT(DISTINCT viewer_id) FROM view_sessions WHERE presentation_id = ?) AS unique_viewers,
          (SELECT COUNT(*) FROM view_sessions WHERE presentation_id = ?) AS total_sessions,
          (SELECT
            CASE
              WHEN SUM(slides_viewed) > 0 THEN CAST(SUM(COALESCE(ended_at, last_activity_at) - started_at) AS REAL) / NULLIF(SUM(slides_viewed), 0)
              ELSE 0
            END
          ) AS avg_ms
        FROM view_sessions WHERE presentation_id = ?
      `).get(p.id, p.id, p.id, p.id) as any

      // Last view time
      const lastView = db.prepare(`
        SELECT created_at FROM view_events WHERE presentation_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(p.id) as any

      return {
        id: p.id,
        title: p.title,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        totalViews: stats?.total_views || 0,
        uniqueViewers: stats?.unique_viewers || 0,
        totalSessions: stats?.total_sessions || 0,
        avgTimePerSlideSec: Math.round((stats?.avg_ms || 0) / 1000),
        lastViewedAt: lastView?.created_at || null,
      }
    })

    // Totals
    const grandTotal = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM view_events ve JOIN presentations p ON p.id = ve.presentation_id WHERE p.user_id = ?) AS total_views,
        (SELECT COUNT(DISTINCT vs.viewer_id) FROM view_sessions vs JOIN presentations p ON p.id = vs.presentation_id WHERE p.user_id = ?) AS total_unique_viewers,
        (SELECT COUNT(*) FROM view_sessions vs JOIN presentations p ON p.id = vs.presentation_id WHERE p.user_id = ?) AS total_sessions
    `).get(userId, userId, userId) as any

    // Views over time (last 30 days, all presentations)
    const viewsOverTime = db.prepare(`
      SELECT
        DATE(ve.created_at / 1000, 'unixepoch') AS day,
        COUNT(*) AS views,
        COUNT(DISTINCT ve.viewer_id) AS unique_viewers
      FROM view_events ve
      JOIN presentations p ON p.id = ve.presentation_id
      WHERE p.user_id = ? AND ve.created_at > ? - 2592000000
      GROUP BY day
      ORDER BY day ASC
    `).all(userId, Date.now()) as any[]

    // Top presentations by views
    const topPresentations = [...presMetrics].sort((a, b) => b.totalViews - a.totalViews).slice(0, 10)

    res.json({
      summary: {
        totalPresentations: presentations.length,
        totalViews: grandTotal?.total_views || 0,
        totalUniqueViewers: grandTotal?.total_unique_viewers || 0,
        totalSessions: grandTotal?.total_sessions || 0,
        sharedPresentations: presentations.length, // all can be shared
      },
      presentations: presMetrics,
      topPresentations,
      viewsOverTime: viewsOverTime.map((r: any) => ({
        day: r.day,
        views: r.views,
        uniqueViewers: r.unique_viewers,
      })),
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to load dashboard'
    res.status(500).json({ error })
  }
})

export default router
