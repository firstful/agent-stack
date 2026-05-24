import { useEffect, useState } from 'react'

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
    } catch { /* ignore */ }
  }

  const handleCopy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(window.location.origin + url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-[90vw] max-w-[480px] max-h-[80vh] overflow-y-auto mx-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Share</h2>
          <button className="btn-ghost btn" onClick={onClose}>✕</button>
        </div>

        <div className="mb-4">
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

        {links.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active links</h3>
            {links.map((link) => (
              <div key={link.id} className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-300 truncate">
                      {window.location.origin}{link.url}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {link.expired ? 'Expired' : `Expires: ${formatTimeLeft(link.expiresAt)}`}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      className={`btn-ghost btn text-xs ${copiedId === link.id ? 'text-green-400' : ''}`}
                      onClick={() => handleCopy(link.url, link.id)}
                    >
                      {copiedId === link.id ? 'Copied!' : 'Copy'}
                    </button>
                    {link.isActive && !link.expired && (
                      <button
                        className="btn-ghost btn text-xs text-red-400"
                        onClick={() => handleRevoke(link.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
