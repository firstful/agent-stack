import { ensureDataDir, getDb } from '../server/db.js'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'

async function seed() {
  ensureDataDir()
  const db = getDb()

  // Create demo user
  const userId = uuidv4()
  const hash = await bcrypt.hash('demo123', 10)
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'demo', hash, Date.now())

  // Create demo presentation
  const presId = uuidv4()
  db.prepare(`INSERT OR IGNORE INTO presentations (id, title, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(presId, 'Demo Presentation', userId, Date.now(), Date.now())

  const markdown = `---
marp: true
theme: default
size: 16:9
paginate: true
---

# Demo Presentation

Welcome to MARP Editor! This is a seeded demo.

---

## Features

- 🤖 AI-powered slide editing via chat
- 🎨 Custom CSS theming
- 🔄 Real-time preview
- 📁 Save and fork presentations

---

## Get Started

Type a message in the chat sidebar to start building!

`

  db.prepare(`INSERT OR IGNORE INTO version_nodes (id, presentation_id, version, parent_version, markdown, css, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), presId, 1, null, markdown, '', 'Demo Presentation', Date.now())

  console.log('Database seeded!')
  console.log('Demo user: demo / demo123')
}

seed().catch(console.error)
