import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { listTemplates, getTemplate } from '../lib/api'
import type { TemplateInfo } from '../lib/api'

interface TemplateSelectorProps {
  onClose: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  management: 'text-amber-400 bg-amber-400/10',
  product: 'text-blue-400 bg-blue-400/10',
  design: 'text-purple-400 bg-purple-400/10',
  engineering: 'text-emerald-400 bg-emerald-400/10',
}

const CATEGORY_ICONS: Record<string, string> = {
  management: '📋',
  product: '💼',
  design: '🎨',
  engineering: '⚙️',
}

export function TemplateSelector({ onClose }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const loadPresentation = useStore((s) => s.loadPresentation)

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load templates'))
      .finally(() => setLoading(false))
  }, [])

  const handleUse = async (t: TemplateInfo) => {
    setLoadingId(t.id)
    setError('')
    try {
      const content = await getTemplate(t.id)
      loadPresentation(content.markdown, '', 'default')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to load template '${t.name}'`)
    } finally {
      setLoadingId(null)
    }
  }

  const categories = [...new Set(templates.map((t) => t.category))]
  const filtered = filter ? templates.filter((t) => t.category === filter) : templates

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-[90vw] max-w-[720px] max-h-[85vh] flex flex-col mx-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>📐</span> Starter Templates
          </h2>
          <button className="btn-ghost btn" onClick={onClose}>✕</button>
        </div>

        {/* Category filter chips */}
        <div className="flex gap-2 mb-4 flex-wrap shrink-0">
          <button
            className={`btn-ghost btn text-xs ${!filter ? 'text-blue-400 ring-1 ring-blue-400/30' : 'text-gray-400'}`}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`btn-ghost btn text-xs ${filter === cat ? 'text-blue-400 ring-1 ring-blue-400/30' : 'text-gray-400'}`}
              onClick={() => setFilter(cat)}
            >
              {CATEGORY_ICONS[cat] || '📁'} {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        {error && <p className="text-red-400 text-xs mb-3 shrink-0">{error}</p>}

        {/* Template grid */}
        <div className="overflow-y-auto flex-1 -mx-2 px-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-gray-500 text-sm">Loading templates...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-gray-500 text-sm">No templates in this category.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  className="bg-gray-800/70 rounded-lg p-4 border border-gray-700/50 hover:border-gray-600 transition-colors flex flex-col"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white leading-tight">{t.name}</h3>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ml-2 ${CATEGORY_COLORS[t.category] || 'text-gray-400 bg-gray-400/10'}`}>
                      {t.category}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-400 leading-relaxed mb-3 flex-1">{t.description}</p>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-700/30">
                    <span className="text-[11px] text-gray-500">
                      {t.slideCount} slides
                    </span>
                    <button
                      className="btn btn-primary text-xs px-3 py-1.5"
                      onClick={() => handleUse(t)}
                      disabled={loadingId === t.id}
                    >
                      {loadingId === t.id ? 'Loading...' : 'Use Template'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
