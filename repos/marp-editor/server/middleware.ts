import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'marp-editor-dev-secret-change-in-prod'

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; username: string }
    ;(req as any).userId = payload.sub
    ;(req as any).username = payload.username
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

export function generateToken(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: '30d' })
}
