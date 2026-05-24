import { useRef, useEffect } from 'react'
import { renderSlideToHtml } from '../lib/marp'

interface SlideThumbnailProps {
  slideIndex: number
  slideHtml: string
  css: string
  onClick: () => void
}

export function SlideThumbnail({ slideIndex, slideHtml, css, onClick }: SlideThumbnailProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = renderSlideToHtml(slideHtml, css)
    }
  }, [slideHtml, css])

  return (
    <button
      onClick={onClick}
      className="block w-full mt-2 rounded-lg overflow-hidden border border-gray-700 hover:border-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="relative bg-white" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          ref={iframeRef}
          title={`Slide ${slideIndex + 1}`}
          className="w-full h-full pointer-events-none"
          sandbox="allow-same-origin"
        />
      </div>
      <div className="bg-gray-800 text-xs text-gray-400 text-center py-1">
        Slide {slideIndex + 1} — click to view
      </div>
    </button>
  )
}
