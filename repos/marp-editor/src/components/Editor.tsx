import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { Presentation } from './Presentation'
import { ChatSidebar } from './ChatSidebar'
import { SlideNavigator } from './SlideNavigator'
import { EditorControls } from './EditorControls'
import { ThemePanel } from './ThemePanel'
import { LoginForm } from './LoginForm'
import { FileManager } from './FileManager'
import { ChangelogModal } from './ChangelogModal'
import { authClient } from '../lib/auth-client'
import { listThemes } from '../lib/api'
import { getNewEntries } from '../lib/changelog'

export function Editor() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [showChangelog, setShowChangelog] = useState(false)

  const {
    layout, setLayout, currentSlide, setCurrentSlide, slides,
    setPalettes, showThemePanel, showFileManager,
    initFromCookies,
  } = useStore()

  useEffect(() => {
    if (!isPending && !session) {
      navigate('/', { replace: true })
    }
  }, [session, isPending, navigate])

  useEffect(() => {
    if (!session) return
    initFromCookies()
    listThemes().then(setPalettes).catch(() => {})
    if (getNewEntries().length > 0) {
      setShowChangelog(true)
    }
  }, [session])

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

  if (isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-500">Loading...</span>
      </div>
    )
  }

  if (!session) return null

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
