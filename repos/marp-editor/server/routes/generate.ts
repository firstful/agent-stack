import { Router, Request, Response } from 'express'
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { parsePresentation } from '../presentation.js'
import { getCost } from '../credits.js'
import { auth, fromNodeHeaders } from '../auth.js'
import { deductCredits, getBalance } from '../credits.js'

const router = Router()

const apiKey = process.env.LLM_DEEPSEEK_TECHDECK_API_KEY || process.env.OPENAI_API_KEY || 'no-key'
const baseUrl = process.env.OPENAI_BASE_URL || 'http://free-llm-router:3000/v1'
const modelName = process.env.LLM_MODEL || 'gpt-4o'
const provider = createOpenAI({ apiKey, baseURL: baseUrl })

const DECK_GEN_SYSTEM = `You are a professional presentation designer who produces MARP (Markdown Presentation) slide decks.

Given a user's prompt, generate a complete, well-designed MARP slide deck. Follow these rules:

## Frontmatter
Every deck MUST start with valid YAML frontmatter:
---
marp: true
theme: default
size: 16:9
paginate: true
---

## Slide Structure
- Use \`---\` on its own line to separate slides
- Start with a title slide: a big heading and subtitle
- Follow with a table-of-contents / agenda slide if 4+ slides
- Content slides should have headings (h2 or h3), bullet lists, or short paragraphs
- End with a conclusion or thank-you slide
- Keep each slide's content concise — aim for 3–6 bullet points max, or a short paragraph plus a visual cue

## Visual Design
- Use MARP directives like \`_backgroundColor\`, \`_class\`, or inline \`<style>\` blocks for visual variety
- On title slides: use a darker background with white or accent text via \`_backgroundColor\` and \`color\` directives
- On section divider slides: use a distinct background colour
- For data slides: use tables or structured lists
- Include emoji or Unicode symbols (📊 📈 🎯 💡 ⚡ 🚀 ✅ ❌) as bullet markers for visual appeal
- Use \`<!-- fit -->\` after main headings to make them fill the slide on key slides

## Quality Guidelines
- Every slide must have substantive content — no placeholder text like "Insert content here"
- Use proper Markdown: heading hierarchy, lists, bold/italic where appropriate
- For any data mentioned, be specific and plausible rather than using "XXX" or "TBD"
- Generate EXACTLY the number of slides the user requests in their prompt
- If the user doesn't specify a number, default to a reasonable deck (4–6 slides)
- Output ONLY the complete MARP markdown — do not wrap in code fences, do not add commentary

## Output format
Output ONLY the raw MARP markdown with frontmatter. No explanations, no code fences. The output will be rendered directly.`

const GEN_COST_FLASH = 1  // 1¢ for flash model
const GEN_COST_PRO = 3    // 3¢ for pro model

router.post('/', async (req: Request, res: Response) => {
  try {
    const { prompt, model } = req.body

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt is required' })
      return
    }

    // Check session and deduct credits
    let session: any = null
    try {
      session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    } catch { /* no session */ }

    const selectedModel = model === 'pro' ? 'pro' : 'flash'
    const cost = selectedModel === 'pro' ? GEN_COST_PRO : GEN_COST_FLASH

    if (session && cost > 0) {
      if (!deductCredits(session.user.id, selectedModel)) {
        res.status(402).json({ error: 'Insufficient credits', balance: getBalance(session.user.id) })
        return
      }
    }

    // Determine which underlying LLM model to use
    const underlyingModel = selectedModel === 'pro'
      ? (process.env.LLM_MODEL_PRO || 'gpt-4o')
      : (process.env.LLM_MODEL || 'gpt-4o')

    const isTest = process.env.TEST_MODE === '1'

    let rawMarkdown: string
    let usage: any = undefined

    if (isTest) {
      const { testLlm } = await import('../llm-test.js')
      rawMarkdown = await testLlm.generate(prompt)
      usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    } else {
      const result = await generateText({
        model: provider(underlyingModel),
        system: DECK_GEN_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Generate a MARP slide deck based on this prompt: ${prompt}`,
          },
        ],
        maxSteps: 1,
      })

      rawMarkdown = result.text?.trim() || ''
      usage = result.totalUsage
    }

    if (!rawMarkdown) {
      res.status(500).json({ error: 'LLM returned empty response' })
      return
    }

    // Parse into slide bundle for the client
    const emptyCss = ''
    const bundle = parsePresentation(rawMarkdown, emptyCss)

    // Extract a title from the frontmatter or first slide
    let title = 'Untitled Deck'
    if (bundle.frontmatter) {
      const titleMatch = bundle.frontmatter.match(/^title:\s*(.+)$/m)
      if (titleMatch) title = titleMatch[1].trim()
    } else if (bundle.slides.length > 0) {
      // Try to extract from first slide markdown
      const firstSlide = bundle.slides[0]
      const h1Match = firstSlide.markdown.match(/^#\s+(.+)$/m)
      if (h1Match) title = h1Match[1].trim()
    }

    // Cost estimate (for display only since we deduct flat rate)
    const IN_RATE = 0.14
    const OUT_RATE = 0.28
    const estimatedCost = usage
      ? (usage.promptTokens * IN_RATE + usage.completionTokens * OUT_RATE) / 1_000_000
      : 0

    const balance = session ? getBalance(session.user.id) : 0

    res.json({
      title,
      markdown: rawMarkdown,
      css: emptyCss,
      slideBundle: bundle,
      usage: usage ? {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      } : undefined,
      cost,
      balance,
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Deck generation failed'
    console.error('Generate deck error:', error)
    res.status(500).json({ error })
  }
})

export default router
