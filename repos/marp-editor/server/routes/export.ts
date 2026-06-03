import { Router, Request, Response } from 'express'
import Marp from '@marp-team/marp-core'
import puppeteer from 'puppeteer'
import type { Browser } from 'puppeteer'

const router = Router()

// ─── Marp rendering ────────────────────────────────────────────────

function renderPresentation(markdown: string, css?: string): { slides: string[]; css: string } {
  const marp = new Marp()
  const rendered = marp.render(markdown)

  const slideRegex = /<section[^>]*>[\s\S]*?<\/section>/g
  const slides: string[] = []
  let match
  while ((match = slideRegex.exec(rendered.html)) !== null) {
    slides.push(match[0])
  }

  const combinedCss = [
    rendered.css,
    css || '',
    `
    section {
      font-family: system-ui, -apple-system, sans-serif;
    }
    `,
  ].join('\n')

  return { slides: slides.length > 0 ? slides : [rendered.html], css: combinedCss }
}

// ─── Browser lifecycle ─────────────────────────────────────────────

let browser: Browser | null = null
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser

  if (browserPromise) return browserPromise

  browserPromise = puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  })

  browser = await browserPromise
  browserPromise = null
  return browser
}

// Graceful shutdown on SIGTERM / SIGINT
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
})
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
})

// ─── Extract title from frontmatter ────────────────────────────────

function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^---[\s\S]*?^title:\s*(.+)$[\s\S]*?^---/m)
  if (match) return match[1].trim()
  return null
}

// ─── Build HTML for PDF rendering ──────────────────────────────────

function buildPdfHtml(slides: string[], css: string): string {
  const slideHtml = slides
    .map(
      (slide, i) => `
      <div class="slide${i > 0 ? ' slide-separator' : ''}">
        ${slide}
      </div>
    `
    )
    .join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    size: 1920px 1080px;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; background: #fff; }
  .slide {
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    position: relative;
  }
  .slide-separator {
    page-break-before: always;
    break-before: page;
  }
  ${css}
  section {
    width: 1920px;
    height: 1080px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 80px;
  }
</style>
</head>
<body>
${slideHtml}
</body>
</html>`
}

// ─── Route: POST /api/export ───────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const { markdown, css } = req.body

    if (!markdown) {
      res.status(400).json({ error: 'markdown is required' })
      return
    }

    // Render markdown to slides via Marp
    const { slides, css: combinedCss } = renderPresentation(markdown, css)

    if (slides.length === 0) {
      res.status(400).json({ error: 'No slides to export' })
      return
    }

    // Build the full HTML document for PDF rendering
    const html = buildPdfHtml(slides, combinedCss)

    // Determine filename based on presentation title
    const title = extractTitle(markdown)
    const filename = title
      ? `presentation-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`
      : 'presentation.pdf'

    // Launch browser and generate PDF
    const br = await getBrowser()
    const page = await br.newPage()

    try {
      await page.setContent(html, { waitUntil: 'networkidle' })

      const pdfBuffer = await page.pdf({
        width: '1920px',
        height: '1080px',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      })

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      })
      res.send(pdfBuffer)
    } finally {
      await page.close()
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'PDF export failed'
    console.error('PDF export error:', error)
    res.status(500).json({ error })
  }
})

export default router
