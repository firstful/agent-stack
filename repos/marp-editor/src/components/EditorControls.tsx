import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { ExportButton } from './ExportButton'

export function EditorControls() {
  const { markdown, setMarkdown, css, setCss, layout, setLayout, toggleThemePanel, toggleFileManager, toggleTemplateSelector } = useStore()
  const [showRaw, setShowRaw] = useState(false)
  const [editMode, setEditMode] = useState<'markdown' | 'css'>('markdown')
  const navigate = useNavigate()

  if (layout === 'fullscreen') return null

  return (
    <div className="border-t border-gray-800 bg-gray-900">
      <div className="flex items-center gap-2 px-2 sm:px-4 py-2 border-b border-gray-800 flex-wrap">
        <button
          className={`btn-ghost btn text-xs ${showRaw ? 'text-blue-400' : ''}`}
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? 'Hide Code' : 'Show Code'}
        </button>
        {showRaw && (
          <>
            <button
              className={`btn-ghost btn text-xs ${editMode === 'markdown' ? 'text-blue-400' : ''}`}
              onClick={() => setEditMode('markdown')}
            >
              Markdown
            </button>
            <button
              className={`btn-ghost btn text-xs ${editMode === 'css' ? 'text-blue-400' : ''}`}
              onClick={() => setEditMode('css')}
            >
              CSS
            </button>
          </>
        )}
        <div className="flex-1" />
        <button className="btn-ghost btn text-xs text-green-500 hover:text-green-400" onClick={() => useStore.getState().setPresenterMode(true)} title="Presenter Mode (P)">
          Present
        </button>
        <button className="btn-ghost btn text-xs" onClick={toggleFileManager} title="File Manager (V2)">
          Files
        </button>
        <button className="btn-ghost btn text-xs" onClick={toggleTemplateSelector} title="Template Library">
          Templates
        </button>
        <button className="btn-ghost btn text-xs" onClick={toggleThemePanel} title="Theme Panel (V4)">
          Theme
        </button>
        <button className="btn-ghost btn text-xs text-purple-400 hover:text-purple-300" onClick={() => navigate('/analytics')} title="Analytics Dashboard">
          Analytics
        </button>
        <ExportButton />
      </div>

      {showRaw && (
        <div className="p-2">
          {editMode === 'markdown' ? (
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="input w-full font-mono text-xs"
              rows={10}
              spellCheck={false}
            />
          ) : (
            <textarea
              value={css}
              onChange={(e) => setCss(e.target.value)}
              className="input w-full font-mono text-xs"
              rows={10}
              spellCheck={false}
            />
          )}
        </div>
      )}
    </div>
  )
}
