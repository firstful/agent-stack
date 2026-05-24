import { Request, Response, NextFunction } from 'express'
import { auth, fromNodeHeaders } from './auth.js'

export async function requireSession(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    ;(req as any).userId = session.user.id
    ;(req as any).session = session
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
