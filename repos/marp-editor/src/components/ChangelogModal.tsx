import { CHANGELOG_ENTRIES, markVersionSeen, CHANGELOG_VERSION } from '../lib/changelog'

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const handleDismiss = () => {
    markVersionSeen(CHANGELOG_VERSION)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleDismiss}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-md w-full p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-blue-400 mb-4">What's New</h2>
        <div className="space-y-3">
          {CHANGELOG_ENTRIES.map(entry => (
            <div key={entry.version} className="border-l-2 border-blue-500 pl-3">
              <div className="text-xs text-gray-500">v{entry.version} — {entry.date}</div>
              <div className="text-sm text-gray-200 mt-1">{entry.message}</div>
            </div>
          ))}
        </div>
        <button
          className="btn btn-primary text-sm px-4 py-2 mt-6 w-full"
          onClick={handleDismiss}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
