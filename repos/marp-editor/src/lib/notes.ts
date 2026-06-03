/**
 * Parse speaker notes from markdown slides.
 *
 * Speaker notes use the syntax: <!-- notes: text -->
 * They can appear anywhere within a slide's markdown section.
 * The markdown is split into slides by `---` separators.
 */

const NOTES_RE = /<!--\s*notes:\s*([\s\S]*?)\s*-->/gi

export interface SlideNotes {
  /** Clean notes text (HTML tag stripped) */
  text: string
  /** Original markdown with the notes comment removed */
  cleanedSection: string
}

/**
 * Extract speaker notes from each slide in the full markdown.
 * Returns an array of note strings, one per slide. Slides without notes
 * get an empty string.
 */
export function parseSpeakerNotes(markdown: string): string[] {
  const sections = markdown.split(/\n---+\n/)
  const notes: string[] = []

  for (const section of sections) {
    NOTES_RE.lastIndex = 0
    const match = NOTES_RE.exec(section)
    const noteText = match ? match[1].trim() : ''
    notes.push(noteText)
  }

  return notes
}

/**
 * Strip <!-- notes: --> comments from markdown before rendering.
 * This prevents notes from appearing as visible HTML comments in the slide.
 */
export function stripNotesFromMarkdown(markdown: string): string {
  return markdown.replace(NOTES_RE, '')
}
