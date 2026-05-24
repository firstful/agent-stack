import { useState } from 'react'
import { useStore } from '../lib/store'
import { scrapeTheme, applyPalette } from '../lib/api'
import { starterThemes } from '../lib/themes'

export function ThemePanel() {
  const {
    showThemePanel, toggleThemePanel, markdown, setMarkdown, setCss,
    palettes, setPalettes,
  } = useStore()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleScrape = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await scrapeTheme({ url: url.trim() })
      setPalettes([res.palette, ...palettes])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to scrape theme')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async (palette: typeof palettes[0]) => {
    try {
      const res = await applyPalette({ markdown, palette })
      if (res.markdown) setMarkdown(res.markdown)
      if (res.css) setCss(res.css)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply palette')
    }
  }

  const handleStarterTheme = (theme: typeof starterThemes[0]) => {
    setCss(theme.css)
    toggleThemePanel()
  }

  if (!showThemePanel) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={toggleThemePanel}>
      <div className="card w-[90vw] max-w-[520px] max-h-[80vh] overflow-y-auto mx-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Theme Panel</h2>
          <button className="btn-ghost btn" onClick={toggleThemePanel}>✕</button>
        </div>

        {/* Starter Themes */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Starter Themes</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {starterThemes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => handleStarterTheme(theme)}
                className="bg-gray-800 hover:bg-gray-700 rounded-lg p-2.5 text-left transition-colors border border-transparent hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title={theme.description}
              >
                <div
                  className="h-10 rounded-md mb-1.5 border border-gray-700"
                  style={{
                    background: theme.css.includes('linear-gradient')
                      ? theme.css.match(/linear-gradient[^;]+/)?.[0] || theme.css.match(/section \{[^}]*background:[^;]+/)?.[0]?.split(':').slice(1).join(':').trim() || '#333'
                      : theme.css.match(/section \{[^}]*background:[^;]+/)?.[0]?.split(':').slice(1).join(':').trim() || '#333',
                  }}
                />
                <p className="text-xs font-medium text-gray-200 truncate">{theme.name}</p>
                <p className="text-[10px] text-gray-500 truncate">{theme.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Import from URL */}
        <div className="mb-5 pt-4 border-t border-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Import Theme</h3>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="input flex-1 text-sm"
            />
            <button onClick={handleScrape} disabled={loading} className="btn btn-primary text-sm">
              {loading ? 'Scraping...' : 'Import'}
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>

        {/* Saved Palettes */}
        {palettes.length > 0 && (
          <div className="pt-4 border-t border-gray-800">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Saved Palettes</h3>
            <div className="space-y-3">
              {palettes.map((p, i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <button className="btn btn-primary text-xs" onClick={() => handleApply(p)}>
                      Apply
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{p.sourceUrl}</p>
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {Object.values(p.colors).flat().filter(Boolean).slice(0, 10).map((c, j) => (
                      c && (
                        <div
                          key={j}
                          className="w-5 h-5 rounded-full border border-gray-600"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      )
                    ))}
                  </div>
                  <div className="text-xs text-gray-400">
                    <span>{p.fonts.heading}</span>
                    <span className="ml-2">{p.fonts.body}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
