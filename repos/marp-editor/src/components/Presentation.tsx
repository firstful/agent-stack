import { useEffect, useRef } from 'react'
import { useStore } from '../lib/store'
import { renderSlideToHtml } from '../lib/marp'

export function Presentation() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { slides, renderedCss, currentSlide, zoom, layout, setCurrentSlide } = useStore()

  useEffect(() => {
    if (iframeRef.current && slides[currentSlide]) {
      const html = renderSlideToHtml(slides[currentSlide], renderedCss)
      iframeRef.current.srcdoc = html
    }
  }, [slides, renderedCss, currentSlide])

  if (slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <div className="text-4xl mb-2">📄</div>
          <p>No slides rendered</p>
        </div>
      </div>
    )
  }

  const zoomStyle = layout === 'fullscreen'
    ? { width: '100vw', height: '100vh' }
    : { width: `${zoom}%`, maxWidth: '100%' }

  return (
    <div className="flex flex-col items-center justify-center h-full p-2 sm:p-4">
      <div
        className="marp-slide cursor-pointer"
        onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))}
        style={{
          ...zoomStyle,
          transform: layout === 'fullscreen' ? 'none' : undefined,
          transformOrigin: 'center center',
        }}
      >
        <iframe
          ref={iframeRef}
          title={`Slide ${currentSlide + 1}`}
          className="w-full h-full rounded-lg"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}
