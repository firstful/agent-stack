import { generateText, tool, stepCountIs } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import { parsePresentation, buildSlideContext, reconstructMarkdown } from './presentation.js'

const apiKey = process.env.LLM_DEEPSEEK_TECHDECK_API_KEY || process.env.OPENAI_API_KEY || 'no-key'
const baseUrl = process.env.OPENAI_BASE_URL || 'http://free-llm-router:3000/v1'
const modelName = process.env.LLM_MODEL || 'gpt-4o'

const provider = createOpenAI({ apiKey, baseURL: baseUrl })

const SYSTEM_PROMPT = `You are a MARP presentation editor assistant. You help users create and edit Markdown-based presentations using the MARP framework.

The presentation is organized as slides. Each slide has its markdown content and slide-specific CSS extracted from directives and inline style blocks. Global CSS applies to all slides.

You have access to these tools:
- edit_slide: Edit a SPECIFIC slide's markdown and optional CSS without touching other slides
- edit_markdown: Replace the ENTIRE markdown content with new content (use edit_slide when possible)
- edit_css: Replace the ENTIRE CSS content with new content
- get_state: Read the current markdown and CSS
- focus_slide: Focus the view on a specific slide after making changes

RULES:
1. Always output valid MARP markdown with frontmatter (marp: true)
2. Use --- to separate slides
3. Keep all existing content unless the user asks to change it
4. For theme changes, use the CSS tool to add/modify styles
5. When creating a new presentation, start with proper MARP front-matter
6. The presentation is rendered at 16:9 aspect ratio
7. Support standard MARP directives like bg, color, class, header, footer
8. For image generation requests, suggest the user use the image generation feature
9. When the user wants to import a theme from a URL, use the apply_theme tool with colors and fonts extracted from the URL
10. After editing slide content, call focus_slide with the slide index to show the user the result`

export interface ToolCallRecord {
  id: string
  type: string
  args: Record<string, unknown>
}

export interface SlideData {
  index: number
  markdown: string
  slideCss: string
}

export interface SlideBundle {
  slides: SlideData[]
  globalCss: string
  frontmatter: string
}

interface ToolCallResult {
  markdown?: string
  css?: string
  slideBundle?: SlideBundle
  toolCalls: ToolCallRecord[]
}

// ── Aggressive context compaction ──────────────────────────────────

const MAX_HISTORY_MSGS = 3
const MAX_HISTORY_CHARS = 200

function pruneHistory(history: { role: string; content: string }[]): { role: string; content: string }[] {
  return history.slice(-MAX_HISTORY_MSGS).map((msg) => ({
    role: msg.role,
    content:
      msg.content.length > MAX_HISTORY_CHARS
        ? msg.content.slice(0, MAX_HISTORY_CHARS) + '…'
        : msg.content,
  }))
}

// Remove old theme palette blocks, keeping only the most recent one.
// Also collapses repeated blank lines.
function compactCss(css: string): string {
  const themeBlockRegex = /\/\* Theme palette \*\/[\s\S]*?\}\n*/g
  const matches = [...css.matchAll(themeBlockRegex)]
  if (matches.length > 1) {
    // Keep only the last theme block
    const lastMatch = matches[matches.length - 1]
    const lastIndex = lastMatch.index!
    css = css.slice(0, css.indexOf('/* Theme palette */')) + lastMatch[0] + css.slice(lastIndex + lastMatch[0].length)
  }
  return css.replace(/\n{3,}/g, '\n\n').trim()
}

function buildContext(md: string, cs: string, msg: string): string {
  const pd = parsePresentation(md, cs)
  const slideCtx = buildSlideContext(pd)

  const totalSlides = pd.slides.length
  const mdLen = md.length
  const cssLen = cs.length

  return [
    'Presentation: ' + totalSlides + ' slides (' + mdLen + ' chars markdown, ' + cssLen + ' chars CSS)',
    '',
    slideCtx,
    '',
    '-'.repeat(40),
    '',
    'User message: ' + msg,
  ].join('\n')
}

// ── Process ────────────────────────────────────────────────────────

export async function processChat(
  message: string,
  currentMarkdown: string,
  currentCss: string,
  history: { role: string; content: string }[]
): Promise<{ reply: string } & ToolCallResult> {
  let resultMarkdown = currentMarkdown
  let resultCss = currentCss

  const result = await generateText({
    model: provider(modelName),
    system: SYSTEM_PROMPT,
    messages: [
      ...pruneHistory(history).map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      {
        role: 'user',
        content: buildContext(currentMarkdown, currentCss, message),
      },
    ],
    tools: {
      edit_markdown: tool({
        description: 'Replace the entire markdown content',
        inputSchema: z.object({
          markdown: z.string().describe('The complete new markdown content'),
        }),
        execute: async ({ markdown }) => {
          resultMarkdown = markdown
          return 'Markdown updated'
        },
      }),
      edit_css: tool({
        description: 'Replace the entire CSS content',
        inputSchema: z.object({
          css: z.string().describe('The complete new CSS content'),
        }),
        execute: async ({ css }) => {
          resultCss = css
          return 'CSS updated'
        },
      }),
      get_state: tool({
        description: 'Read the current markdown and CSS state. Use this when you need to see the full content that was truncated.',
        inputSchema: z.object({}),
        execute: async () => ({
          markdown: resultMarkdown,
          css: resultCss,
          markdownLength: resultMarkdown.length,
          cssLength: resultCss.length,
        }),
      }),
      edit_slide: tool({
        description: 'Edit a SPECIFIC slide markdown and optional CSS without affecting other slides. Use this instead of edit_markdown when changing only one slide.',
        inputSchema: z.object({
          slideIndex: z.number().int().min(0).describe('The 0-based slide index to edit'),
          markdown: z.string().describe('The complete new markdown content for this slide only'),
          css: z.string().optional().describe('Optional slide-specific CSS. Use to set background, color, etc.'),
        }),
        execute: async ({ slideIndex, markdown: slideMd, css: slideCs }) => {
          const pd = parsePresentation(resultMarkdown, resultCss)
          const target = pd.slides.find((s) => s.index === slideIndex)
          if (!target) return 'Slide not found'
          target.markdown = slideMd
          if (slideCs !== undefined) target.slideCss = slideCs
          resultMarkdown = reconstructMarkdown(pd)
          return 'Slide ' + (slideIndex + 1) + ' updated'
        },
      }),
      focus_slide: tool({
        description: 'Focus the view on a specific slide after making changes',
        inputSchema: z.object({
          slideIndex: z.number().int().min(0).describe('The 0-based slide index to focus on'),
        }),
        execute: async ({ slideIndex }) => ({
          slideIndex,
        }),
      }),
      apply_theme: tool({
        description: 'Apply a color palette and fonts to the presentation. Extracted from a website URL or user-provided.',
        inputSchema: z.object({
          primary: z.string().describe('Primary color hex (e.g. #2563eb)'),
          secondary: z.string().optional().describe('Secondary color hex'),
          background: z.string().describe('Background color hex'),
          text: z.string().describe('Text color hex'),
          accent: z.string().optional().describe('Accent color hex'),
          fontHeading: z.string().optional().describe('Heading font name'),
          fontBody: z.string().optional().describe('Body font name'),
        }),
        execute: async (args) => {
          const themeCss = `/* Theme palette */
:root {
  --marp-primary: ${args.primary};
  --marp-secondary: ${args.secondary || '#64748b'};
  --marp-background: ${args.background};
  --marp-text: ${args.text};
  --marp-accent: ${args.accent || '#f59e0b'};
  --marp-font-heading: '${args.fontHeading || 'system-ui'}', sans-serif;
  --marp-font-body: '${args.fontBody || 'system-ui'}', sans-serif;
}

section {
  background: var(--marp-background);
  color: var(--marp-text);
  font-family: var(--marp-font-body);
}

h1, h2, h3, h4, h5, h6 {
  color: var(--marp-primary);
  font-family: var(--marp-font-heading);
}

a { color: var(--marp-accent); }`
          resultCss = compactCss(resultCss ? resultCss + '\n' + themeCss : themeCss)
          return 'Theme applied'
        },
      }),
    },
    stopWhen: stepCountIs(5),
  })

  const toolCalls: ToolCallRecord[] = []
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      toolCalls.push({ id: tc.toolCallId, type: tc.toolName, args: tc.args as Record<string, unknown> })
    }
  }

  const resultBundle = parsePresentation(resultMarkdown, resultCss)
  const slideBundle: SlideBundle = {
    slides: resultBundle.slides.map((s) => ({ index: s.index, markdown: s.markdown, slideCss: s.slideCss })),
    globalCss: resultBundle.globalCss,
    frontmatter: resultBundle.frontmatter,
  }

  // Cost estimate: DeepSeek v4 flash pricing (per million tokens)
  const IN_RATE = 0.14
  const OUT_RATE = 0.28
  const usage = result.totalUsage
  const estimatedCost = usage
    ? (usage.promptTokens * IN_RATE + usage.completionTokens * OUT_RATE) / 1_000_000
    : 0

  return {
    reply: result.text || '',
    markdown: resultMarkdown,
    css: resultCss,
    slideBundle,
    toolCalls,
    usage: usage ? {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    } : undefined,
  }
}
