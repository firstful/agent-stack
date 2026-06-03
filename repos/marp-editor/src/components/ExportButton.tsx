import { useState } from 'react'
import { useStore } from '../lib/store'
import { exportPdf } from '../lib/api'

export function ExportButton() {
  const { markdown, css } = useStore()
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      await exportPdf(markdown, css)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF export failed'
      setError(msg)
      console.error('Export PDF error:', msg)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="relative inline-flex items-center">
      <button
        className="btn-ghost btn text-xs"
        onClick={handleExport}
        disabled={exporting}
        title="Export as PDF via server"
      >
        {exporting ? 'Exporting…' : 'Export PDF'}
      </button>
      {error && (
        <div className="absolute top-full right-0 mt-1 bg-red-900 text-red-200 text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50">
          {error}
          <button
            className="ml-2 text-red-300 hover:text-red-100"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
