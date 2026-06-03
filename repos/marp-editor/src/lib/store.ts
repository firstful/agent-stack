import { create } from 'zustand'
import type { ChatMessage, LayoutMode, ThemePalette, User } from '../types'
import { generateId, saveToCookies, loadFromCookies } from './cookies'
import { renderSlides } from './marp'
import { parseSpeakerNotes } from './notes'

const DEFAULT_MARKDOWN = `---
marp: true
theme: default
size: 16:9
paginate: true
---

# Welcome to MARP Editor

Create beautiful presentations with AI assistance

---

## How it works

1. Chat with the AI to build your slides
2. Edit markdown directly in split mode
3. Apply themes and generate images

---

## Features

- 🤖 AI-powered slide generation
- 🎨 Custom CSS theming
- 📐 16:9 widescreen format
- 🔄 Real-time preview

---

## Get Started

Type a message in the chat to begin building your presentation!
`

const DEFAULT_CSS = `/* Custom CSS - modify to style your presentation */
section {
  background: white;
  color: #1a1a2e;
}

h1 {
  color: #0f3460;
}

h2 {
  color: #16213e;
}
`

interface AppState {
  pid: string
  markdown: string
  css: string
  theme: string
  slides: string[]
  renderedCss: string
  currentSlide: number
  messages: ChatMessage[]
  layout: LayoutMode
  zoom: number
  isGenerating: boolean
  showThemePanel: boolean
  showFileManager: boolean
  showTemplateSelector: boolean
  palettes: ThemePalette[]
  showOutline: boolean
  model: 'flash' | 'pro'
  balance: number
  speakerNotes: string[]
  presenterMode: boolean

  setMarkdown: (md: string) => void
  setCss: (css: string) => void
  setTheme: (theme: string) => void
  setLayout: (layout: LayoutMode) => void
  setCurrentSlide: (n: number) => void
  addMessage: (msg: ChatMessage) => void
  setIsGenerating: (v: boolean) => void
  toggleThemePanel: () => void
  toggleFileManager: () => void
  toggleTemplateSelector: () => void
  setPalettes: (p: ThemePalette[]) => void
  setShowOutline: (v: boolean) => void
  setModel: (m: 'flash' | 'pro') => void
  setBalance: (b: number) => void
  reRender: () => void
  initFromCookies: () => void
  saveState: () => void
  loadPresentation: (markdown: string, css: string, theme?: string) => void
  setPresenterMode: (v: boolean) => void
  updateSpeakerNote: (slideIndex: number, text: string) => void
}

export const useStore = create<AppState>((set, get) => ({
  pid: generateId(),
  markdown: DEFAULT_MARKDOWN,
  css: DEFAULT_CSS,
  theme: 'default',
  slides: [],
  renderedCss: '',
  currentSlide: 0,
  messages: [
    {
      id: 'system-1',
      role: 'system',
      content: 'Welcome! Describe the presentation you want to create, or ask me to modify the current slides.',
      timestamp: Date.now(),
    },
  ],
  layout: 'chat',
  zoom: 100,
  isGenerating: false,
  showThemePanel: false,
  showFileManager: false,
  showTemplateSelector: false,
  palettes: [],
  showOutline: true,
  model: 'flash',
  balance: 0,
  speakerNotes: [],
  presenterMode: false,

  setMarkdown: (markdown) => {
    set({ markdown })
    get().reRender()
    get().saveState()
  },

  setCss: (css) => {
    set({ css })
    get().reRender()
    get().saveState()
  },

  setTheme: (theme) => {
    set({ theme })
    get().saveState()
  },

  setLayout: (layout) => set({ layout }),

  setCurrentSlide: (n) => set({ currentSlide: n }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  setIsGenerating: (v) => set({ isGenerating: v }),

  toggleThemePanel: () => set((s) => ({ showThemePanel: !s.showThemePanel })),

  toggleFileManager: () => set((s) => ({ showFileManager: !s.showFileManager })),

  toggleTemplateSelector: () => set((s) => ({ showTemplateSelector: !s.showTemplateSelector })),

  setPalettes: (palettes) => set({ palettes }),
  setShowOutline: (showOutline) => set({ showOutline }),
  setModel: (model) => set({ model }),
  setBalance: (balance) => set({ balance }),

  reRender: () => {
    const { markdown, css } = get()
    try {
      const result = renderSlides(markdown, css)
      const notes = parseSpeakerNotes(markdown)
      set({
        slides: result.slides,
        renderedCss: result.css,
        speakerNotes: notes,
      })
    } catch {
      // render failed, keep previous state
    }
  },

  initFromCookies: () => {
    const saved = loadFromCookies()
    if (saved) {
      set({
        pid: saved.pid,
        markdown: saved.md,
        css: saved.css,
        theme: saved.theme,
      })
    }
    get().reRender()
  },

  saveState: () => {
    const { pid, markdown, css, theme } = get()
    saveToCookies({ pid, md: markdown, css, theme })
  },

  loadPresentation: (markdown, css, theme) => {
    set({ markdown, css, theme: theme || 'default', currentSlide: 0 })
    get().reRender()
    get().saveState()
  },

  setPresenterMode: (presenterMode) => set({ presenterMode }),

  updateSpeakerNote: (slideIndex, text) => {
    const { markdown } = get()
    const sections = markdown.split(/\n---+\n/)
    if (slideIndex < 0 || slideIndex >= sections.length) return

    // Remove any existing notes comment from this section
    const cleanSection = sections[slideIndex].replace(/<!--\s*notes:\s*[\s\S]*?\s*-->/gi, '').trim()

    // Build new section: notes go at the end before the separator
    const newSection = text.trim()
      ? `${cleanSection}\n\n<!-- notes: ${text} -->`
      : cleanSection

    sections[slideIndex] = newSection
    const newMarkdown = sections.join('\n---\n')
    get().setMarkdown(newMarkdown)
  },
}))
