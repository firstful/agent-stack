import { useStore } from '../lib/store'

export function SlideNavigator() {
  const { slides, currentSlide, setCurrentSlide } = useStore()

  if (slides.length === 0) return null

  return (
    <div className="flex items-center gap-2 sm:gap-3 justify-center py-2 px-2 overflow-x-auto">
      <button
        className="btn-ghost btn min-w-[44px] min-h-[44px] flex items-center justify-center"
        onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
        disabled={currentSlide === 0}
      >
        ◀
      </button>
      <span className="text-sm text-gray-400 min-w-[80px] sm:min-w-[100px] text-center whitespace-nowrap">
        {currentSlide + 1} / {slides.length}
      </span>
      <button
        className="btn-ghost btn min-w-[44px] min-h-[44px] flex items-center justify-center"
        onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))}
        disabled={currentSlide === slides.length - 1}
      >
        ▶
      </button>
      <span className="text-xs sm:text-sm text-gray-500 ml-1 sm:ml-2 whitespace-nowrap">{useStore.getState().zoom}%</span>
      <input
        type="range"
        min={50}
        max={200}
        value={useStore.getState().zoom}
        onChange={(e) => useStore.setState({ zoom: Number(e.target.value) })}
        className="w-16 sm:w-24 accent-blue-500"
      />
    </div>
  )
}
