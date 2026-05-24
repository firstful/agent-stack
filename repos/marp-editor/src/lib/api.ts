const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  return res.json()
}

export interface ToolCallData {
  id: string
  type: string
  args: Record<string, unknown>
}

export interface ChatRequest {
  message: string
  markdown: string
  css: string
  history: { role: string; content: string }[]
  model?: string
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

export interface ChatResponse {
  message: string
  markdown: string
  css: string
  slideBundle?: SlideBundle
  toolCalls: ToolCallData[]
}

export async function sendChat(req: ChatRequest): Promise<ChatResponse> {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface ImageGenRequest {
  prompt: string
  slideIndex: number
}

export interface ImageGenResponse {
  url: string
  revisedPrompt: string
}

export async function generateImage(req: ImageGenRequest): Promise<ImageGenResponse> {
  return request('/generate-image', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface ScrapeThemeRequest {
  url: string
}

export async function scrapeTheme(req: ScrapeThemeRequest): Promise<ScrapeThemeResponse> {
  return request('/scrape-theme', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface ScrapeThemeResponse {
  palette: ThemePalette
  favicon?: { href: string; sizes: string } | null
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
}

export interface ApplyPaletteRequest {
  markdown: string
  palette: ThemePalette
}

export interface ApplyPaletteResponse {
  markdown: string
  css: string
}

export async function applyPalette(req: ApplyPaletteRequest): Promise<ApplyPaletteResponse> {
  return request('/apply-palette', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface PresentationResponse {
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
}

export interface VersionNodeResponse {
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

// Better-Auth automatically sends session cookies with same-origin requests.
// Auth token parameters are no longer needed.

export async function listPresentations(): Promise<PresentationResponse[]> {
  return request('/presentations')
}

export async function createPresentation(title: string, markdown: string, css: string): Promise<PresentationResponse> {
  return request('/presentations', {
    method: 'POST',
    body: JSON.stringify({ title, markdown, css }),
  })
}

export async function getPresentation(id: string): Promise<PresentationResponse> {
  return request(`/presentations/${id}`)
}

export async function updatePresentation(id: string, markdown: string, css: string): Promise<PresentationResponse> {
  return request(`/presentations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ markdown, css }),
  })
}

export async function forkPresentation(id: string, version: number): Promise<PresentationResponse> {
  return request(`/presentations/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  })
}

export async function getVersions(id: string): Promise<VersionNodeResponse[]> {
  return request(`/presentations/${id}/versions`)
}

export async function listThemes(): Promise<ThemePalette[]> {
  return request('/themes')
}

export async function saveTheme(palette: ThemePalette): Promise<{ id: string }> {
  return request('/themes', {
    method: 'POST',
    body: JSON.stringify(palette),
  })
}
