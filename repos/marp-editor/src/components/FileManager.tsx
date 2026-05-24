import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { authClient } from '../lib/auth-client'
import { listPresentations, createPresentation, getPresentation, updatePresentation, forkPresentation, getVersions } from '../lib/api'
import { ShareDialog } from './ShareDialog'
import type { PresentationResponse, VersionNodeResponse } from '../lib/api'

export function FileManager() {
  const { data: session, isPending } = authClient.useSession()
  const {
    showFileManager, toggleFileManager,
    markdown, css, loadPresentation,
  } = useStore()
  const [presentations, setPresentations] = useState<PresentationResponse[]>([])
  const [versions, setVersions] = useState<VersionNodeResponse[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sharePresId, setSharePresId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (showFileManager && session) {
      loadList()
    }
  }, [showFileManager, session])

  const loadList = async () => {
    if (!session) return
    setLoading(true)
    try {
      const list = await listPresentations()
      setPresentations(list)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!session) return
    setLoading(true)
    setError('')
    try {
      const res = await createPresentation(newTitle || 'Untitled', markdown, css)
      setPresentations([res, ...presentations])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = async (id: string) => {
    if (!session) return
    setLoading(true)
    try {
      const pres = await getPresentation(id)
      loadPresentation(pres.markdown, pres.css, pres.theme)
      toggleFileManager()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open')
    } finally {
      setLoading(false)
    }
  }

  const handleFork = async (id: string, version: number) => {
    if (!session) return
    setLoading(true)
    try {
      const forked = await forkPresentation(id, version)
      loadPresentation(forked.markdown, forked.css, forked.theme)
      toggleFileManager()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fork')
    } finally {
      setLoading(false)
    }
  }

  const showVersions = async (id: string) => {
    if (!session) return
    setSelectedId(id)
    try {
      const v = await getVersions(id)
      setVersions(v)
    } catch {
      setVersions([])
    }
  }

  if (!showFileManager) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={toggleFileManager}>
      <div className="card w-[90vw] max-w-[600px] max-h-[80vh] overflow-y-auto mx-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">File Manager</h2>
          <button className="btn-ghost btn" onClick={toggleFileManager}>✕</button>
        </div>

        {!session ? (
          <p className="text-gray-500 text-sm text-center py-8">
            Log in to save and manage presentations.
          </p>
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Presentation title..."
                className="input flex-1 text-sm"
              />
              <button onClick={handleSave} disabled={loading} className="btn btn-primary text-sm">
                Save Current
              </button>
            </div>

            {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

            <div className="space-y-2">
              {presentations.map((p) => (
                <div key={p.id} className="bg-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{p.title}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        v{p.version} · {new Date(p.updatedAt).toLocaleDateString()}
                      </span>
                      {p.forkOrigin && (
                        <span className="text-xs text-yellow-500 ml-2">{p.forkOrigin}</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button className="btn-ghost btn text-xs" onClick={() => handleOpen(p.id)}>Open</button>
                      <button className="btn-ghost btn text-xs" onClick={() => setSharePresId(p.id)}>Share</button>
                      <button className="btn-ghost btn text-xs" onClick={() => showVersions(p.id)}>Versions</button>
                      <button className="btn-ghost btn text-xs" onClick={() => handleFork(p.id, p.version)}>Fork</button>
                    </div>
                  </div>

                  {selectedId === p.id && versions.length > 0 && (
                    <div className="mt-2 pl-4 border-l border-gray-700 space-y-1">
                      {versions.map((v) => (
                        <div key={v.id} className="flex items-center justify-between text-xs text-gray-400">
                          <span>
                            v{v.version}
                            {v.isFork && <span className="text-yellow-500 ml-1">({v.forkLabel || 'fork'})</span>}
                          </span>
                          <div className="flex gap-1">
                            <button className="btn-ghost btn text-xs" onClick={() => {
                              loadPresentation(v.markdown, v.css, 'default')
                              toggleFileManager()
                            }}>Load</button>
                            <button className="btn-ghost btn text-xs" onClick={() => handleFork(p.id, v.version)}>Fork</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {presentations.length === 0 && !loading && (
              <p className="text-gray-500 text-sm text-center py-4">
                No saved presentations.
              </p>
            )}

            {loading && <p className="text-gray-500 text-sm text-center py-2">Loading...</p>}
          </>
        )}
      </div>
      {sharePresId && (
        <ShareDialog presentationId={sharePresId} onClose={() => setSharePresId(null)} />
      )}
    </div>
  )
}
