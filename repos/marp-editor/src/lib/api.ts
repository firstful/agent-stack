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

export interface GenerateDeckRequest {
  prompt: string
  model?: 'flash' | 'pro'
}

export interface GenerateDeckResponse {
  title: string
  markdown: string
  css: string
  slideBundle: SlideBundle
  cost: number
  balance: number
}

export async function generateDeck(req: GenerateDeckRequest): Promise<GenerateDeckResponse> {
  return request('/generate', {
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

// ─── Analytics / view tracking ──────────────────────────────────────────

export interface ViewEvent {
  viewerId: string
  slideIndex: number
  eventType: 'view' | 'slide_change' | 'heartbeat'
  sessionId?: string
}

export async function recordView(token: string, event: ViewEvent): Promise<{ ok: boolean; sessionId: string; eventId: string }> {
  const res = await fetch(`/api/share/${token}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Failed to record view')
  }
  return res.json()
}

export async function endViewSession(token: string, viewerId: string, sessionId: string): Promise<void> {
  await fetch(`/api/share/${token}/view/session/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewerId, sessionId }),
  })
}

export interface PresentationAnalytics {
  totalViews: number
  uniqueViewers: number
  totalSessions: number
  avgTimePerSlideMs: number
  avgTimePerSlideSec: number
  viewsOverTime: { day: string; views: number; uniqueViewers: number }[]
  slidePopularity: { slideIndex: number; totalViews: number; uniqueViewers: number }[]
  recentSessions: {
    id: string
    viewerId: string
    startedAt: number
    endedAt: number | null
    lastActivityAt: number
    slidesViewed: number
    totalSlides: number
    maxSlideIndex: number
    durationMs: number
  }[]
}

export async function getPresentationAnalytics(id: string): Promise<PresentationAnalytics> {
  return request(`/presentations/${id}/analytics`)
}

export interface DashboardMetrics {
  summary: {
    totalPresentations: number
    totalViews: number
    totalUniqueViewers: number
    totalSessions: number
    sharedPresentations: number
  }
  presentations: {
    id: string
    title: string
    createdAt: number
    updatedAt: number
    totalViews: number
    uniqueViewers: number
    totalSessions: number
    avgTimePerSlideSec: number
    lastViewedAt: number | null
  }[]
  topPresentations: {
    id: string
    title: string
    totalViews: number
    uniqueViewers: number
    totalSessions: number
    avgTimePerSlideSec: number
    lastViewedAt: number | null
  }[]
  viewsOverTime: { day: string; views: number; uniqueViewers: number }[]
}

export async function getAnalyticsDashboard(): Promise<DashboardMetrics> {
  return request('/analytics/dashboard')
}

// ─── Embed API ─────────────────────────────────────────────────

export interface EmbedSnippetResponse {
  html: string
  url: string
  title: string
  slides: number | null
  options: {
    bgColor: string | null
    accentColor: string | null
    fontFamily: string | null
    logoUrl: string | null
    showTitle: boolean
  }
}

export interface EmbedBrandingOptions {
  bgColor?: string
  accentColor?: string
  fontFamily?: string
  logoUrl?: string
  showTitle?: boolean
}

export async function getEmbedSnippet(token: string, options?: EmbedBrandingOptions): Promise<EmbedSnippetResponse> {
  const params = new URLSearchParams()
  if (options?.bgColor) params.set('bg_color', options.bgColor)
  if (options?.accentColor) params.set('accent_color', options.accentColor)
  if (options?.fontFamily) params.set('font_family', options.fontFamily)
  if (options?.logoUrl) params.set('logo_url', options.logoUrl)
  if (options?.showTitle === false) params.set('show_title', 'false')
  const qs = params.toString()
  return fetch(qs ? `/api/embed/${token}/snippet?${qs}` : `/api/embed/${token}/snippet`).then(r => {
    if (!r.ok) throw new Error('Failed to get embed snippet')
    return r.json()
  })
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

export async function exportPdf(markdown: string, css: string): Promise<void> {
  const res = await fetch(`${BASE}/export/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, css }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition')
  let filename = 'presentation.pdf'
  if (disposition) {
    const match = disposition.match(/filename="?(.+?)"?$/)
    if (match) filename = match[1]
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// --- Templates API ---

export interface TemplateInfo {
  id: string
  name: string
  description: string
  category: string
  slideCount: number
  tags: string[]
}

export interface TemplateContent extends TemplateInfo {
  markdown: string
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  return request('/templates')
}

export async function getTemplate(id: string): Promise<TemplateContent> {
  return request(`/templates/${id}`)
}
