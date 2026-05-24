export interface ToolCallInfo {
  id: string
  type: string
  args: Record<string, unknown>
}

export interface SlideAttachment {
  slideIndex: number
  slideHtml: string
  css: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: ToolCallInfo[]
  attachment?: SlideAttachment
}

export interface Presentation {
  id: string
  title: string
  markdown: string
  css: string
  theme: string
  version: number
  parentId: string | null
  forkOrigin: string | null
  createdAt: number
  updatedAt: number
  userId: string | null
}

export interface VersionNode {
  id: string
  presentationId: string
  version: number
  parentVersion: number | null
  markdown: string
  css: string
  title: string
  createdAt: number
  isFork: boolean
  forkLabel: string | null
}

export interface ThemePalette {
  id?: string
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
  logo?: {
    dataUrl: string
    position: { x: number; y: number; width: number; height: number }
  }
}

export interface User {
  id: string
  username: string
  createdAt?: number
}

export type LayoutMode = 'chat' | 'split' | 'fullscreen'
