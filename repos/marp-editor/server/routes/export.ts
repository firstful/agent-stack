import { Router, Request, Response } from 'express'
import Marp from '@marp-team/marp-core'
import { chromium, Browser } from 'playwright'

const router = Router()

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    return browser
  }
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  return browser
}

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

// POST /api/export (mounted at /api/export) — render markdown and return a PDF file
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
        'Content-Disposition': 'attachment; filename="presentation.pdf"',
        'Content-Length': pdfBuffer.length.toString(),
      })
      res.send(pdfBuffer)
    } finally {
      await page.close()
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'PDF export failed'
    res.status(500).json({ error })
  }
})

export default router
