import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db.js'

const COST_PER_MODEL: Record<string, number> = {
  flash: 1,
  pro: 5,
}

export function getBalance(userId: string): number {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) as balance FROM credit_ledger WHERE user_id = ?').get(userId) as any
  return row.balance
}

export function deductCredits(userId: string, model: string): boolean {
  const cost = COST_PER_MODEL[model]
  if (!cost) return false
  const balance = getBalance(userId)
  if (balance < cost) return false
  const db = getDb()
  db.prepare(`
    INSERT INTO credit_ledger (id, user_id, amount, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, -cost, model + ' chat', Date.now())
  return true
}

export function grantCredits(userId: string, amount: number, description: string): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO credit_ledger (id, user_id, amount, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, amount, description, Date.now())
}

export function getCost(model: string): number {
  return COST_PER_MODEL[model] || 0
}
