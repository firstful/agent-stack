import Marp from '@marp-team/marp-core'
import { stripNotesFromMarkdown } from './notes'

let marpInstance: Marp | null = null

function getMarp(): Marp {
  if (!marpInstance) {
    marpInstance = new Marp()
  }
  return marpInstance
}

export function renderSlides(markdown: string, css?: string): {
  html: string
  slides: string[]
  css: string
|} {
  const marp = getMarp()
  // Strip speaker-notes HTML comments from the markdown so they don't
  // appear as visual artifacts in the rendered slide HTML. Notes are
  // parsed separately by parseSpeakerNotes() in the store's reRender.
  const cleanMd = stripNotesFromMarkdown(markdown)
  const rendered = marp.render(cleanMd)

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

  return {
    html: rendered.html,
    slides: slides.length > 0 ? slides : [rendered.html],
    css: combinedCss,
  }
}

export function renderSlideToHtml(slideHtml: string, css: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  ${css}
</style>
</head>
<body>
  ${slideHtml}
</body>
</html>
  `
}
