import { useStore } from '../lib/store'

export function NotesEditor() {
  const {
    speakerNotes, currentSlide, slides, updateSpeakerNote,
    layout, setLayout,
  } = useStore()

  if (layout === 'fullscreen') return null
  if (slides.length === 0) return null

  const note = speakerNotes[currentSlide] || ''

  return (
    <div className="border-t border-gray-800 bg-gray-900/80">
      <details className="group" open={!!note}>
        <summary className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-gray-800/50 transition-colors">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span className="text-xs font-medium text-gray-400">
            Speaker Notes
          </span>
          {note && (
            <span className="text-[10px] text-gray-600 ml-auto">
              Slide {currentSlide + 1}
            </span>
          )}
        </summary>
        <div className="px-3 pb-2">
          <textarea
            value={note}
            onChange={(e) => updateSpeakerNote(currentSlide, e.target.value)}
            placeholder="Type speaker notes for this slide... (<!-- notes: -->)"
            className="input w-full font-sans text-xs resize-none"
            rows={3}
            spellCheck
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-gray-600">
              Notes appear in presenter mode (press <kbd className="px-1 py-0.5 bg-gray-800 rounded text-[10px] text-gray-400">P</kbd>)
            </span>
            <span className="text-[10px] text-gray-700">
              {note.length} chars
            </span>
          </div>
        </div>
      </details>
    </div>
  )
}
