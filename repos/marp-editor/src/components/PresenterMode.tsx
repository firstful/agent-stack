import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../lib/store'
import { renderSlideToHtml } from '../lib/marp'

export function PresenterMode() {
  const {
    slides, renderedCss, currentSlide, setCurrentSlide,
    speakerNotes, presenterMode, setPresenterMode,
    setLayout,
  } = useStore()

  const slideRef = useRef<HTMLIFrameElement>(null)
  const nextRef = useRef<HTMLIFrameElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const timerStartRef = useRef<number | null>(null)

  // Render current slide
  useEffect(() => {
    if (slideRef.current && slides[currentSlide]) {
      slideRef.current.srcdoc = renderSlideToHtml(slides[currentSlide], renderedCss)
    }
  }, [slides, renderedCss, currentSlide])

  // Render next slide preview
  const nextIndex = Math.min(currentSlide + 1, slides.length - 1)
  useEffect(() => {
    if (nextRef.current && slides[nextIndex]) {
      nextRef.current.srcdoc = renderSlideToHtml(slides[nextIndex], renderedCss)
    }
  }, [slides, renderedCss, nextIndex])

  // Timer logic
  useEffect(() => {
    if (presenterMode && !timerStartRef.current) {
      timerStartRef.current = Date.now()
      setElapsed(0)
      setTimerRunning(true)
    }

    if (!presenterMode) {
      timerStartRef.current = null
      setElapsed(0)
      setTimerRunning(false)
      return
    }

    const interval = setInterval(() => {
      if (timerStartRef.current) {
        setElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000))
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [presenterMode])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setPresenterMode(false)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCurrentSlide(Math.max(0, currentSlide - 1))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault()
      setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))
    }
  }, [currentSlide, slides.length, setPresenterMode, setCurrentSlide])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Don't render if not in presenter mode or no slides
  if (!presenterMode || slides.length === 0) return null

  const note = speakerNotes[currentSlide] || ''
  const hasNext = currentSlide < slides.length - 1
  const isFirst = currentSlide === 0
  const isLast = currentSlide === slides.length - 1

  // Format timer as MM:SS
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timerStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-[100] bg-[#1a1a2e] text-white flex flex-col select-none">
      {/* Top bar: navigation + timer + exit */}
      <div className="flex items-center justify-between px-6 py-3 bg-[#16213e] border-b border-gray-700/50">
        <div className="flex items-center gap-4">
          <button
            className={`btn-ghost btn text-sm ${isFirst ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
            onClick={() => !isFirst && setCurrentSlide(currentSlide - 1)}
            disabled={isFirst}
          >
            ◀ Previous
          </button>
          <span className="text-sm font-medium text-blue-300 tabular-nums min-w-[80px] text-center">
            {currentSlide + 1} / {slides.length}
          </span>
          <button
            className={`btn-ghost btn text-sm ${isLast ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
            onClick={() => !isLast && setCurrentSlide(currentSlide + 1)}
            disabled={isLast}
          >
            Next ▶
          </button>
        </div>

        <div className="flex items-center gap-4">
          {/* Timer */}
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-mono tabular-nums text-gray-300">{timerStr}</span>
          </div>

          <button
            className="btn-ghost btn text-xs text-gray-500 hover:text-gray-300"
            onClick={() => setPresenterMode(false)}
            title="Exit presenter mode (Esc)"
          >
            Exit (Esc)
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Slide area */}
        <div className="flex-1 flex items-center justify-center p-4 lg:p-6 relative">
          <div
            className="marp-slide cursor-pointer shadow-2xl"
            style={{ width: '100%', maxWidth: '960px', height: 'auto', aspectRatio: '16 / 9' }}
            onClick={() => !isLast && setCurrentSlide(currentSlide + 1)}
          >
            <iframe
              ref={slideRef}
              title={`Slide ${currentSlide + 1}`}
              className="w-full h-full rounded-lg"
              sandbox="allow-same-origin"
            />
          </div>

          {/* Next slide thumbnail — top-right corner */}
          {hasNext && (
            <div className="absolute top-4 right-4 lg:top-6 lg:right-6">
              <div className="bg-gray-800/80 backdrop-blur rounded-lg p-2 shadow-lg border border-gray-700/50">
                <div className="text-[10px] text-gray-500 mb-1 text-center uppercase tracking-wider">
                  Next
                </div>
                <div
                  className="rounded overflow-hidden border border-gray-600/50"
                  style={{ width: '160px', aspectRatio: '16 / 9' }}
                >
                  <iframe
                    ref={nextRef}
                    title={`Next slide ${nextIndex + 1}`}
                    className="w-full h-full pointer-events-none"
                    sandbox="allow-same-origin"
                    style={{ transform: 'scale(0.5)', transformOrigin: '0 0', width: '200%', height: '200%' }}
                  />
                </div>
                <div className="text-[10px] text-gray-600 text-center mt-1">
                  Slide {nextIndex + 1}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Speaker notes panel — right side on large screens, bottom on small */}
        <div className="lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-gray-700/50 bg-[#16213e]/50 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700/50">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Speaker Notes
            </span>
            <span className="text-[10px] text-gray-600 ml-auto">
              Slide {currentSlide + 1}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {note ? (
              <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                {note}
              </div>
            ) : (
              <div className="text-sm text-gray-600 italic">
                No speaker notes for this slide.
              </div>
            )}
          </div>

          {/* Slide progress bar */}
          <div className="px-4 py-3 border-t border-gray-700/50">
            <div className="flex gap-1">
              {slides.map((_, i) => (
                <button
                  key={i}
                  className={`flex-1 h-1.5 rounded-full transition-colors ${
                    i === currentSlide
                      ? 'bg-blue-500'
                      : i < currentSlide
                        ? 'bg-blue-500/40'
                        : 'bg-gray-700'
                  }`}
                  onClick={() => setCurrentSlide(i)}
                  title={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-gray-600">
              <span>{slides.length} slides</span>
              <span>{elapsed >= 60 ? `${minutes}m ${seconds}s` : `${seconds}s`} elapsed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
