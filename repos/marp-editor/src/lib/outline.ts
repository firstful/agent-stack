export interface SlideOutlineEntry {
  index: number
  title: string
  level: number
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm

export function parseSlideOutline(markdown: string): SlideOutlineEntry[] {
  const sections = markdown.split(/\n---+\n/)
  const entries: SlideOutlineEntry[] = []

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim()
    let title = `Slide ${i + 1}`
    let level = 1

    HEADING_RE.lastIndex = 0
    const match = HEADING_RE.exec(section)
    if (match) {
      title = match[2].trim()
      level = match[1].length
    }

    entries.push({ index: i, title, level })
  }

  // Merge duplicate consecutive titles caused by front-matter (---)
  // Front-matter section is at index 0 if it starts with ---
  const merged: SlideOutlineEntry[] = []
  for (const entry of entries) {
    if (merged.length > 0 && merged[merged.length - 1].title === entry.title) {
      continue
    }
    merged.push(entry)
  }

  return merged
}
