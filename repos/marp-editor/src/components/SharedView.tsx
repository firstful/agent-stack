import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { renderSlides, renderSlideToHtml } from '../lib/marp'

interface SharedData {
  title: string
  markdown: string
  css: string
}

export function SharedView() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<SharedData | null>(null)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)
  const [slideHtml, setSlideHtml] = useState<string[]>([])
  const [renderedCss, setRenderedCss] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/share/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 410 ? 'Link expired or revoked' : 'Not found')
        return r.json()
      })
      .then((d: SharedData) => {
        setData(d)
        const result = renderSlides(d.markdown, d.css)
        setSlideHtml(result.slides)
        setRenderedCss(result.css)
      })
      .catch((e) => setError(e.message))
  }, [token])

  useEffect(() => {
    if (iframeRef.current && slideHtml[current]) {
      iframeRef.current.srcdoc = renderSlideToHtml(slideHtml[current], renderedCss)
    }
  }, [slideHtml, renderedCss, current])

  const handleClose = () => navigate('/')

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="text-center text-gray-300">
          <div className="text-5xl mb-4">🔗</div>
          <p className="text-lg mb-2">{error}</p>
          <button onClick={handleClose} className="btn btn-primary mt-4">Back</button>
        </div>
      </div>
    )
  }

  if (!data || slideHtml.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <h1 className="text-sm font-bold text-blue-400 truncate">{data.title}</h1>
        <button onClick={handleClose} className="btn-ghost btn text-xs text-gray-400">Close</button>
      </div>
      <div
        className="flex-1 flex items-center justify-center cursor-pointer"
        onClick={() => current < slideHtml.length - 1 && setCurrent(current + 1)}
      >
        <div className="w-full max-w-4xl mx-4" style={{ aspectRatio: '16 / 9' }}>
          <iframe
            ref={iframeRef}
            title={`Slide ${current + 1}`}
            className="w-full h-full rounded-lg"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 py-3 bg-gray-900">
        <button
          className="btn-ghost btn min-w-[44px] min-h-[44px] flex items-center justify-center"
          onClick={() => setCurrent(Math.max(0, current - 1))}
          disabled={current === 0}
        >
          ◀
        </button>
        <span className="text-sm text-gray-400">
          {current + 1} / {slideHtml.length}
        </span>
        <button
          className="btn-ghost btn min-w-[44px] min-h-[44px] flex items-center justify-center"
          onClick={() => setCurrent(Math.min(slideHtml.length - 1, current + 1))}
          disabled={current === slideHtml.length - 1}
        >
          ▶
        </button>
      </div>
    </div>
  )
}
