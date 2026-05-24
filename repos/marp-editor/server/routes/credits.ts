import { Router, Request, Response } from 'express'
import { requireSession } from '../session'
import { getBalance, grantCredits } from '../credits'

const router = Router()

// GET /api/credits/balance — current user's balance
router.get('/credits/balance', requireSession, (req: Request, res: Response) => {
  const userId = (req as any).userId
  res.json({ balance: getBalance(userId) })
})

// POST /api/credits/grant — admin: grant credits to a user
router.post('/credits/grant', requireSession, (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const adminToken = process.env.ADMIN_TOKEN || process.env.VAULT_PASSWORD || ''
  if (!token || token !== adminToken) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const { userId, amount, description } = req.body
  if (!userId || !amount) {
    res.status(400).json({ error: 'userId and amount are required' })
    return
  }
  grantCredits(userId, amount, description || 'admin grant')
  res.json({ balance: getBalance(userId) })
})

export default router
