import './tracing.js'
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureDataDir, getDb } from './db.js'
import { auth, toNodeHandler } from './auth.js'

// Routes
import chatRouter from './routes/chat.js'
import presRouter from './routes/pres.js'

import themeRouter from './routes/theme.js'
import shareRouter from './routes/share.js'
import creditsRouter from './routes/credits.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

// Ensure data directory and init DB
ensureDataDir()
getDb()

// Better-Auth — must be before express.json() for raw body access
app.all('/api/auth/*', toNodeHandler(auth))

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '5mb' }))

// API Routes
app.use('/api/chat', chatRouter)
app.use('/api/presentations', presRouter)
app.use('/api', themeRouter)
app.use('/api', shareRouter)
app.use('/api', creditsRouter)

// Test mode routes — configure deterministic LLM responses
if (process.env.TEST_MODE === '1') {
  const { testLlm } = await import('./llm-test.js')

  app.post('/api/test/set-llm-responses', (req, res) => {
    const { responses } = req.body
    if (!Array.isArray(responses)) {
      res.status(400).json({ error: 'responses array is required' })
      return
    }
    testLlm.setResponses(responses)
    res.json({ ok: true, count: responses.length })
  })

  app.post('/api/test/reset', (_req, res) => {
    testLlm.reset()
    res.json({ ok: true })
  })

  app.get('/api/test/status', (_req, res) => {
    res.json({ mode: 'test', db: path.join(__dirname, '..', 'data', 'marp.db') })
  })

  console.log('🧪 TEST_MODE active — deterministic LLM enabled')
}

// Serve static frontend in production
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath))
app.get('*', (_, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`TechDeck server running on http://localhost:${PORT}`)
})
