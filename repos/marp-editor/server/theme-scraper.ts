// Theme scraper - V4 feature
// Uses Playwright to scrape a URL and extract design tokens

export interface ScrapedPalette {
  name: string
  sourceUrl: string
  colors: {
    primary: string
    secondary: string
    background: string
    text: string
    accent: string
    additional: string[]
  }
  fonts: {
    heading: string
    body: string
    fallback: string
  }
}

interface ElementInfo {
  tag: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
  color: string
  bgColor: string
  fontFamily: string
  fontSize: number
  fontWeight: number
}

function hexColor(c: string): string | null {
  if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null
  if (c.startsWith('#')) return c
  if (c.startsWith('rgb')) {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (m) {
      return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('')
    }
  }
  return null
}

function getLuminance(hex: string): number {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export async function scrapeTheme(url: string): Promise<ScrapedPalette> {
  // Check cache first
  const cached = getCachedTheme(url)
  if (cached) return cached

  let chromium: any
  try {
    chromium = (await import('playwright')).chromium
  } catch {
    throw new Error('Playwright is not installed. Run: npx playwright install chromium')
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    const elements: ElementInfo[] = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*')
      const results: ElementInfo[] = []
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight

      allElements.forEach((el) => {
        const tag = el.tagName.toLowerCase()
        if (['script', 'style', 'link', 'meta', 'noscript', 'svg', 'path'].includes(tag)) return

        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        if (rect.width / viewportW < 0.01 && rect.height / viewportH < 0.01) return

        const style = window.getComputedStyle(el)
        const text = (el.textContent || '').trim().slice(0, 100)

        results.push({
          tag,
          text,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          color: style.color,
          bgColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: parseFloat(style.fontSize) || 16,
          fontWeight: parseInt(style.fontWeight) || 400,
        })
      })

      return results
    })

    const viewportArea = 1920 * 1080
    const significantElements = elements.filter(e => (e.rect.width * e.rect.height) / viewportArea > 0.01)

    // Extract colors
    const colorCount = new Map<string, { count: number; totalArea: number }>()
    for (const el of significantElements) {
      const c = hexColor(el.color)
      if (c) {
        const existing = colorCount.get(c) || { count: 0, totalArea: 0 }
        existing.count++
        existing.totalArea += el.rect.width * el.rect.height
        colorCount.set(c, existing)
      }
      const bg = hexColor(el.bgColor)
      if (bg) {
        const existing = colorCount.get(bg) || { count: 0, totalArea: 0 }
        existing.count++
        existing.totalArea += el.rect.width * el.rect.height
        colorCount.set(bg, existing)
      }
    }

    const sortedColors = [...colorCount.entries()]
      .sort((a, b) => b[1].totalArea - a[1].totalArea)
      .map(([c]) => c)

    // Extract fonts
    const fontCount = new Map<string, number>()
    for (const el of significantElements) {
      const font = el.fontFamily.split(',')[0].replace(/["']/g, '').trim()
      if (font && font !== 'serif' && font !== 'sans-serif') {
        fontCount.set(font, (fontCount.get(font) || 0) + el.rect.width * el.rect.height)
      }
    }

    const sortedFonts = [...fontCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f)

    // Assign colors
    const backgrounds = sortedColors.filter(c => getLuminance(c) > 0.7)
    const texts = sortedColors.filter(c => getLuminance(c) < 0.4)
    const accents = sortedColors.filter(c => {
      const l = getLuminance(c)
      return l > 0.3 && l < 0.7
    })

    const palette: ScrapedPalette = {
      name: new URL(url).hostname,
      sourceUrl: url,
      colors: {
        background: backgrounds[0] || '#ffffff',
        text: texts[0] || '#1a1a1a',
        primary: sortedColors[1] || sortedColors[0] || '#2563eb',
        secondary: sortedColors[2] || sortedColors[1] || '#64748b',
        accent: accents[0] || '#f59e0b',
        additional: sortedColors.slice(5, 10),
      },
      fonts: {
        heading: sortedFonts[0] || 'system-ui',
        body: sortedFonts[1] || sortedFonts[0] || 'system-ui',
        fallback: 'sans-serif',
      },
    }

    // Cache the result
    setCachedTheme(url, palette)

    return palette
  } finally {
    await browser.close()
  }
}

export interface FaviconInfo {
  href: string
  sizes: string
}

export async function scrapeFavicon(url: string): Promise<FaviconInfo | null> {
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const favicon = await page.evaluate(() => {
        const links = document.querySelectorAll('link[rel*="icon"]')
        for (const link of links) {
          const href = link.getAttribute('href')
          if (href) return { href, sizes: link.getAttribute('sizes') || '' }
        }
        return null
      })
      return favicon
    } finally {
      await browser.close()
    }
  } catch {
    return null
  }
}

export function paletteToCss(palette: ScrapedPalette): string {
  return `/* Theme: ${palette.name} */
/* Source: ${palette.sourceUrl} */

section {
  background-color: ${palette.colors.background};
  color: ${palette.colors.text};
  font-family: "${palette.fonts.body}", ${palette.fonts.fallback};
}

h1, h2, h3, h4, h5, h6 {
  color: ${palette.colors.primary};
  font-family: "${palette.fonts.heading}", ${palette.fonts.fallback};
}

a {
  color: ${palette.colors.accent};
}

::selection {
  background: ${palette.colors.secondary}44;
}
`
}

export function paletteToMarpTheme(palette: ScrapedPalette): string {
  return `/* @theme ${palette.name} */
/* @auto-scraped from ${palette.sourceUrl} */

:root {
  --primary: ${palette.colors.primary};
  --secondary: ${palette.colors.secondary};
  --background: ${palette.colors.background};
  --text: ${palette.colors.text};
  --accent: ${palette.colors.accent};
  --heading-font: "${palette.fonts.heading}", ${palette.fonts.fallback};
  --body-font: "${palette.fonts.body}", ${palette.fonts.fallback};
}

section {
  background-color: var(--background);
  color: var(--text);
  font-family: var(--body-font);
}

h1, h2, h3, h4, h5, h6 {
  color: var(--primary);
  font-family: var(--heading-font);
}

a {
  color: var(--accent);
}
`
}

export function applyPaletteToMarkdown(markdown: string, palette: ScrapedPalette): string {
  // Inject palette CSS variables and update theme
  const themeBlock = `<!--
theme: ${palette.name}
-->`

  // Replace existing theme in frontmatter
  let result = markdown
  if (result.includes('theme:')) {
    result = result.replace(/theme:\s*\S+/, `theme: ${palette.name}`)
  } else if (result.startsWith('---')) {
    const end = result.indexOf('---', 3)
    if (end > 0) {
      const front = result.slice(0, end)
      const rest = result.slice(end)
      result = front + `theme: ${palette.name}\n` + rest
    }
  }

  return result
}

// ── In-memory cache with 24h TTL ──

interface CacheEntry {
  palette: ScrapedPalette
  expiresAt: number
}

const themeCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function getCachedTheme(url: string): ScrapedPalette | null {
  const entry = themeCache.get(url)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    themeCache.delete(url)
    return null
  }
  return entry.palette
}

export function setCachedTheme(url: string, palette: ScrapedPalette): void {
  themeCache.set(url, { palette, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function invalidateCachedTheme(url: string): void {
  themeCache.delete(url)
}
