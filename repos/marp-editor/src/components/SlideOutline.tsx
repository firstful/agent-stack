import { useMemo, useRef, useEffect } from 'react'
import { useStore } from '../lib/store'
import { parseSlideOutline } from '../lib/outline'

export function SlideOutline() {
  const markdown = useStore((s) => s.markdown)
  const currentSlide = useStore((s) => s.currentSlide)
  const setCurrentSlide = useStore((s) => s.setCurrentSlide)
  const showOutline = useStore((s) => s.showOutline)
  const setShowOutline = useStore((s) => s.setShowOutline)
  const activeRef = useRef<HTMLButtonElement>(null)

  const entries = useMemo(() => parseSlideOutline(markdown), [markdown])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentSlide, entries.length])

  if (!showOutline) return null

  return (
    <div className="border-b border-gray-800">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Outline
        </span>
        <button
          className="btn-ghost btn text-xs text-gray-500"
          onClick={() => setShowOutline(false)}
        >
          ✕
        </button>
      </div>
      <nav className="max-h-[240px] overflow-y-auto px-2 pb-2 space-y-0.5">
        {entries.map((entry) => {
          const isActive = entry.index === currentSlide
          const padLeft = 8 + (entry.level - 1) * 12
          return (
            <button
              key={entry.index}
              ref={isActive ? activeRef : undefined}
              onClick={() => setCurrentSlide(entry.index)}
              className={[
                'w-full text-left rounded px-2 py-1 text-xs transition-colors duration-100',
                isActive
                  ? 'bg-blue-600/20 text-blue-300 border-l-2 border-blue-500'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800 border-l-2 border-transparent',
              ].join(' ')}
              style={{ paddingLeft: `${padLeft}px` }}
            >
              <span className="text-[10px] text-gray-600 mr-1.5 tabular-nums">
                {entry.index + 1}
              </span>
              {entry.title}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
