export interface SlideData {
  index: number
  markdown: string
  slideCss: string
}

export interface PresentationData {
  slides: SlideData[]
  globalCss: string
  frontmatter: string
}

const DIRECTIVE_RE = /<!--\s*_(\w+):\s*(.+?)\s*-->/g
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi
const SLIDE_SEP_RE = /\n---\n/

function generateDirectiveCss(directives: Record<string, string>): string {
  const rules: string[] = []
  for (const [key, val] of Object.entries(directives)) {
    switch (key) {
      case 'backgroundColor':
        rules.push(`  background-color: ${val};`)
        break
      case 'color':
        rules.push(`  color: ${val};`)
        break
      case 'backgroundImage':
        rules.push(`  background-image: url(${val});`)
        break
    }
  }
  if (rules.length === 0) return ''
  const cls = directives.class || 'custom-slide'
  const sel = `section${cls === 'custom-slide' ? '.custom-slide' : '.' + cls}`
  return `${sel} {\n${rules.join('\n')}\n}\n`
}

function parseDirectives(slideMd: string): { cleaned: string; directives: Record<string, string> } {
  const directives: Record<string, string> = {}
  const cleaned = slideMd.replace(DIRECTIVE_RE, (_, key, val) => {
    directives[key] = val.trim()
    return ''
  })
  return { cleaned, directives }
}

function extractInlineStyles(slideMd: string): { cleaned: string; styles: string[] } {
  const styles: string[] = []
  const cleaned = slideMd.replace(STYLE_BLOCK_RE, (match) => {
    const inner = match.replace(/<\/?style[^>]*>/gi, '')
    styles.push(inner.trim())
    return ''
  })
  return { cleaned, styles }
}

export function parsePresentation(markdown: string, css: string): PresentationData {
  let body = markdown.trim()
  let frontmatter = ''

  if (body.startsWith('---')) {
    const fmEnd = body.indexOf('---', 3)
    if (fmEnd !== -1) {
      frontmatter = body.slice(0, fmEnd + 3).trim()
      body = body.slice(fmEnd + 3).trim()
    }
  }

  const rawBlocks = body.split(SLIDE_SEP_RE)
  const slides: SlideData[] = []
  let slideIndex = 0

  for (const block of rawBlocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    const { cleaned: noStyles, styles: inlineStyles } = extractInlineStyles(trimmed)
    const { cleaned, directives } = parseDirectives(noStyles)
    const directiveCss = generateDirectiveCss(directives)
    const slideCss = [directiveCss, ...inlineStyles].filter(Boolean).join('\n')

    slides.push({
      index: slideIndex++,
      markdown: cleaned.trim(),
      slideCss,
    })
  }

  return { slides, globalCss: css, frontmatter }
}

export function buildSlideContext(pd: PresentationData): string {
  const parts: string[] = []

  if (pd.frontmatter) {
    const fmContent = pd.frontmatter.replace(/^---\n?/, '').replace(/\n?---$/, '')
    parts.push('Frontmatter:\n```yaml\n' + fmContent + '\n```\n')
  }

  for (const slide of pd.slides) {
    const lines = ['---', 'Slide ' + (slide.index + 1) + ':', '']
    lines.push('```markdown')
    lines.push(slide.markdown)
    lines.push('```')
    if (slide.slideCss) {
      lines.push('')
      lines.push('Slide-specific CSS:')
      lines.push('```css')
      lines.push(slide.slideCss)
      lines.push('```')
    }
    parts.push(lines.join('\n'))
  }

  if (pd.globalCss) {
    parts.push('---\nGlobal CSS:\n```css\n' + pd.globalCss + '\n```')
  }

  return parts.join('\n\n')
}

export function reconstructMarkdown(pd: PresentationData): string {
  const parts: string[] = []
  if (pd.frontmatter) {
    const fm = pd.frontmatter.endsWith('---') ? pd.frontmatter.slice(0, -3).trim() : pd.frontmatter
    parts.push(fm)
  }
  for (const slide of pd.slides) {
    parts.push(slide.markdown)
  }
  const sep = '\n---\n'
  return parts.join(sep)
}
