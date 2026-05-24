import { Router, Request, Response } from 'express'
import { testProcessChat, testLlm } from '../llm-test.js'
import { auth, fromNodeHeaders } from '../auth.js'
import { deductCredits, getBalance, getCost } from '../credits.js'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, markdown, css, history, model } = req.body

    if (!message) {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    // Check session and deduct credits
    let session: any = null
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    } catch { /* no session */ }

    const selectedModel = model === 'pro' ? 'pro' : 'flash'
    const cost = getCost(selectedModel)

    if (session && cost > 0) {
      if (!deductCredits(session.user.id, selectedModel)) {
        res.status(402).json({ error: 'Insufficient credits', balance: getBalance(session.user.id) })
        return
      }
    }

    const isTest = process.env.TEST_MODE === '1'
    const processFn = isTest ? testProcessChat : (await import('../llm.js')).processChat
    const result = await processFn(message, markdown || '', css || '', history || [])

    const balance = session ? getBalance(session.user.id) : 0

    res.json({
      message: result.reply,
      markdown: result.markdown,
      css: result.css,
      slideBundle: result.slideBundle,
      toolCalls: result.toolCalls,
      usage: (result as any).usage,
      model: selectedModel,
      cost,
      balance,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'LLM request failed'
    res.status(500).json({ error })
  }
})

export default router
