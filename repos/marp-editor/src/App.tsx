import { useEffect, useState } from 'react'
import { useStore } from './lib/store'
import { Presentation } from './components/Presentation'
import { ChatSidebar } from './components/ChatSidebar'
import { SlideNavigator } from './components/SlideNavigator'
import { EditorControls } from './components/EditorControls'
import { ThemePanel } from './components/ThemePanel'

import { LoginForm } from './components/LoginForm'
import { FileManager } from './components/FileManager'
import { SharedView } from './components/SharedView'
import { ChangelogModal } from './components/ChangelogModal'
import { clearCookies } from './lib/cookies'
import { listThemes } from './lib/api'
import { getNewEntries } from './lib/changelog'

export default function App() {
  const [shareToken, setShareToken] = useState<string | null>(() => {
    const m = window.location.pathname.match(/^\/share\/([a-f0-9]+)$/)
    return m ? m[1] : null
  })
  const [showChangelog, setShowChangelog] = useState(false)

  const {
    layout, setLayout, currentSlide, setCurrentSlide, slides,
    setPalettes, showThemePanel, showFileManager,
    initFromCookies,
  } = useStore()

  useEffect(() => {
    initFromCookies()
    listThemes().then(setPalettes).catch(() => {})
    if (getNewEntries().length > 0) {
      setShowChangelog(true)
    }
  }, [])

  if (shareToken) {
    return <SharedView token={shareToken} onClose={() => {
      window.history.replaceState(null, '', '/')
      setShareToken(null)
    }} />
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && layout === 'fullscreen') {
        setLayout('chat')
      }
      if (e.key === 'ArrowLeft') {
        setCurrentSlide(Math.max(0, currentSlide - 1))
      }
      if (e.key === 'ArrowRight') {
        setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))
      }
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        setLayout(layout === 'fullscreen' ? 'chat' : 'fullscreen')
      }
      if (e.key === 'm' && !e.ctrlKey && !e.metaKey) {
        setLayout(layout === 'split' ? 'chat' : 'split')
      }
      if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
        useStore.getState().toggleThemePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [layout, currentSlide, slides.length])

  if (layout === 'fullscreen') {
    return (
      <div className="fixed inset-0 bg-black z-50" onClick={() => {
        if (currentSlide < slides.length - 1) setCurrentSlide(currentSlide + 1)
      }}>
        <Presentation />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <SlideNavigator />
        </div>
        <button
          className="absolute top-4 right-4 btn-ghost btn text-gray-500"
          onClick={(e) => { e.stopPropagation(); setLayout('chat') }}
        >
          Exit (Esc)
        </button>
      </div>
    )
  }

  const isSplit = layout === 'split'

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-2 sm:px-4 py-2 bg-gray-900 border-b border-gray-800 min-h-[48px]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-xs sm:text-sm font-bold text-blue-400">MARP</h1>
          <span className="text-[10px] sm:text-xs text-gray-600 hidden sm:inline">|</span>
          <span className="text-[10px] sm:text-xs text-gray-400 truncate">
            {useStore.getState().messages.filter(m => m.role !== 'system').length > 0
              ? `${slides.length} slides`
              : 'New'}
          </span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <LoginForm />
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
        {isSplit ? (
          <>
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-auto">
                <div className="flex flex-col md:flex-row h-full">
                  <div className="flex-1 overflow-auto p-2 min-h-[200px]">
                    <textarea
                      value={useStore.getState().markdown}
                      onChange={(e) => useStore.getState().setMarkdown(e.target.value)}
                      className="input w-full h-full font-mono text-sm resize-none"
                      spellCheck={false}
                    />
                  </div>
                  <div className="flex-1 overflow-auto">
                    <Presentation />
                  </div>
                </div>
              </div>
              <SlideNavigator />
              <EditorControls />
            </div>
            <ChatSidebar />
          </>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <ChatSidebar />
            </div>
            <SlideNavigator />
            <EditorControls />
          </div>
        )}
      </div>
      <ThemePanel />
      <FileManager />
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  )
}
