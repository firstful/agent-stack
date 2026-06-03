import { useEffect, useState } from 'react'
import { getEmbedSnippet, type EmbedSnippetResponse, type EmbedBrandingOptions } from '../lib/api'

interface ShareLink {
  id: string
  token: string
  url: string
  createdAt: number
  expiresAt: number | null
  isActive: boolean
  expired: boolean
}

interface ShareDialogProps {
  presentationId: string
  onClose: () => void
}

const LIFETIME_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
  { label: 'Never', value: 0 },
]

const DEFAULT_BG = '#0f0f0f'
const DEFAULT_ACCENT = '#3b82f6'

function formatTimeLeft(expiresAt: number | null): string {
  if (!expiresAt) return 'Never'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'Expired'
  const hours = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return `${hours}h ${mins}m`
}

export function ShareDialog({ presentationId, onClose }: ShareDialogProps) {
  const [links, setLinks] = useState<ShareLink[]>([])
  const [lifetime, setLifetime] = useState(86400)
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [embedForToken, setEmbedForToken] = useState<string | null>(null)
  const [embedData, setEmbedData] = useState<EmbedSnippetResponse | null>(null)
  const [embedLoading, setEmbedLoading] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)
  const [branding, setBranding] = useState<EmbedBrandingOptions>({})

  const loadLinks = async () => {
    try {
      const res = await fetch(`/api/presentations/${presentationId}/shares`)
      if (res.ok) setLinks(await res.json())
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadLinks()
  }, [presentationId])

  const handleCreate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/presentations/${presentationId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: lifetime || null }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || 'Failed to create link')
      }
      await loadLinks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create share link')
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async (linkId: string) => {
    try {
      await fetch(`/api/presentations/${presentationId}/share/${linkId}`, { method: 'DELETE' })
      await loadLinks()
      if (embedForToken) setEmbedForToken(null)
    } catch { /* ignore */ }
  }

  const handleCopy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(window.location.origin + url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { /* ignore */ }
  }

  const handleFetchEmbed = async (token: string) => {
    setEmbedForToken(token)
    setEmbedLoading(true)
    setEmbedData(null)
    setEmbedCopied(false)
    setBranding({})
    try {
      const data = await getEmbedSnippet(token)
      setEmbedData(data)
    } catch (err) {
      setEmbedData(null)
    } finally {
      setEmbedLoading(false)
    }
  }

  const handleRefreshEmbed = async () => {
    if (!embedForToken) return
    setEmbedLoading(true)
    try {
      const data = await getEmbedSnippet(embedForToken, branding)
      setEmbedData(data)
    } catch { /* ignore */ }
    setEmbedLoading(false)
  }

  const handleCopyEmbed = async () => {
    if (!embedData) return
    try {
      await navigator.clipboard.writeText(embedData.html)
      setEmbedCopied(true)
      setTimeout(() => setEmbedCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const handleBrandingChange = (key: keyof EmbedBrandingOptions, value: string | boolean | undefined) => {
    setBranding(prev => {
      const next = { ...prev, [key]: value }
      // Strip undefined
      if (value === undefined) delete next[key]
      return next
    })
  }

  const activeLinks = links.filter(l => l.isActive && !l.expired)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-[90vw] max-w-[560px] max-h-[85vh] overflow-y-auto mx-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Share & Embed</h2>
          <button className="btn-ghost btn" onClick={onClose}>✕</button>
        </div>

        {/* ── Share Link Section ── */}
        <div className="mb-4">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Share Link</h3>
          <label className="block text-sm text-gray-400 mb-2">Link lifetime</label>
          <div className="flex gap-2 flex-wrap">
            {LIFETIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`btn text-xs ${lifetime === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setLifetime(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="btn btn-primary w-full text-sm mb-4"
        >
          {loading ? 'Creating...' : 'Generate Share Link'}
        </button>

        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

        {activeLinks.map((link) => (
          <div key={link.id} className="bg-gray-800 rounded-lg p-3 mb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-300 truncate">
                  {window.location.origin}{link.url}
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Expires: {formatTimeLeft(link.expiresAt)}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  className={`btn-ghost btn text-xs ${copiedId === link.id ? 'text-green-400' : ''}`}
                  onClick={() => handleCopy(link.url, link.id)}
                >
                  {copiedId === link.id ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  className={`btn-ghost btn text-xs ${embedForToken === link.token ? 'text-purple-400' : ''}`}
                  onClick={() => handleFetchEmbed(link.token)}
                >
                  Embed
                </button>
                <button
                  className="btn-ghost btn text-xs text-red-400"
                  onClick={() => handleRevoke(link.id)}
                >
                  Revoke
                </button>
              </div>
            </div>

            {/* ── Embed Panel (expanded per link) ── */}
            {embedForToken === link.token && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <h4 className="text-xs font-medium text-purple-400 mb-3">Embed Code</h4>

                {/* Branding options */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Background Color</label>
                    <div className="flex gap-1 items-center">
                      <input
                        type="color"
                        value={branding.bgColor || DEFAULT_BG}
                        onChange={(e) => handleBrandingChange('bgColor', e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="text"
                        value={branding.bgColor || ''}
                        onChange={(e) => handleBrandingChange('bgColor', e.target.value || undefined)}
                        placeholder={DEFAULT_BG}
                        className="input flex-1 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Accent Color</label>
                    <div className="flex gap-1 items-center">
                      <input
                        type="color"
                        value={branding.accentColor || DEFAULT_ACCENT}
                        onChange={(e) => handleBrandingChange('accentColor', e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <input
                        type="text"
                        value={branding.accentColor || ''}
                        onChange={(e) => handleBrandingChange('accentColor', e.target.value || undefined)}
                        placeholder={DEFAULT_ACCENT}
                        className="input flex-1 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Font Family</label>
                    <input
                      type="text"
                      value={branding.fontFamily || ''}
                      onChange={(e) => handleBrandingChange('fontFamily', e.target.value || undefined)}
                      placeholder="system-ui, sans-serif"
                      className="input w-full text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Logo URL</label>
                    <input
                      type="text"
                      value={branding.logoUrl || ''}
                      onChange={(e) => handleBrandingChange('logoUrl', e.target.value || undefined)}
                      placeholder="https://example.com/logo.png"
                      className="input w-full text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branding.showTitle !== false}
                      onChange={(e) => handleBrandingChange('showTitle', e.target.checked === false ? false : undefined)}
                      className="rounded border-gray-600"
                    />
                    Show title bar
                  </label>
                  <button
                    onClick={handleRefreshEmbed}
                    disabled={embedLoading}
                    className="btn-ghost btn text-xs text-purple-400 ml-auto"
                  >
                    {embedLoading ? 'Updating...' : 'Update Preview'}
                  </button>
                </div>

                {/* Embed code output */}
                {embedData && (
                  <>
                    <div className="relative mb-2">
                      <pre className="bg-gray-950 rounded p-2 text-[10px] text-green-300 font-mono overflow-x-auto max-h-[120px] whitespace-pre-wrap break-all">
                        {embedData.html}
                      </pre>
                      <button
                        className={`absolute top-1 right-1 btn-ghost btn text-[10px] ${embedCopied ? 'text-green-400' : 'text-gray-400'}`}
                        onClick={handleCopyEmbed}
                      >
                        {embedCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Paste this code into any HTML page to embed the slide deck.
                      Width/height are adjustable in the iframe attributes.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {activeLinks.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">
            No active share links. Create one above to enable embedding.
          </p>
        )}
      </div>
    </div>
  )
}
