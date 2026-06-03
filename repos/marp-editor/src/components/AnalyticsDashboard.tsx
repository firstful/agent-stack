import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth-client'
import { getAnalyticsDashboard, getPresentationAnalytics } from '../lib/api'
import type { DashboardMetrics, PresentationAnalytics } from '../lib/api'

export function AnalyticsDashboard() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null)
  const [selectedAnalytics, setSelectedAnalytics] = useState<PresentationAnalytics | null>(null)
  const [selectedPresId, setSelectedPresId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isPending && !session) {
      navigate('/', { replace: true })
    }
  }, [session, isPending, navigate])

  useEffect(() => {
    if (!session) return
    loadDashboard()
  }, [session])

  const loadDashboard = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getAnalyticsDashboard()
      setDashboard(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  const loadPresentationDetail = async (id: string) => {
    setDetailLoading(true)
    setSelectedPresId(id)
    try {
      const data = await getPresentationAnalytics(id)
      setSelectedAnalytics(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setDetailLoading(false)
    }
  }

  const formatNumber = (n: number): string => {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return n.toLocaleString()
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return '<1s'
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const rem = sec % 60
    return `${min}m ${rem}s`
  }

  const formatDate = (ts: number): string => {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/editor')} className="btn-ghost btn text-sm text-gray-400">
            ← Back to Editor
          </button>
          <h1 className="text-lg font-bold text-white">Analytics</h1>
        </div>
        <button onClick={loadDashboard} className="btn-ghost btn text-xs text-gray-400" disabled={loading}>
          Refresh
        </button>
      </header>

      {/* Error */}
      {error && (
        <div className="px-6 py-2">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && !dashboard && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      {dashboard && (
        <div className="px-6 py-4 max-w-6xl mx-auto space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Views</p>
              <p className="text-3xl font-bold text-white mt-1">{formatNumber(dashboard.summary.totalViews)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Unique Viewers</p>
              <p className="text-3xl font-bold text-white mt-1">{formatNumber(dashboard.summary.totalUniqueViewers)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Viewing Sessions</p>
              <p className="text-3xl font-bold text-white mt-1">{formatNumber(dashboard.summary.totalSessions)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Presentations</p>
              <p className="text-3xl font-bold text-white mt-1">{dashboard.summary.totalPresentations}</p>
            </div>
          </div>

          {/* Views Over Time Chart (simplified bar chart) */}
          {dashboard.viewsOverTime.length > 0 && (
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-white mb-3">Views (Last 30 Days)</h2>
              <div className="flex items-end gap-1 h-24">
                {dashboard.viewsOverTime.map((d) => {
                  const maxVal = Math.max(...dashboard.viewsOverTime.map((x) => x.views), 1)
                  const height = Math.max((d.views / maxVal) * 100, 2)
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.views} views`}>
                      <div
                        className="w-full bg-blue-500/80 rounded-t"
                        style={{ height: `${height}%`, minHeight: '2px' }}
                      />
                      <span className="text-[8px] text-gray-600 truncate w-full text-center">
                        {d.day.slice(5)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top Presentations */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Top Presentations</h2>
            {dashboard.topPresentations.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No analytics data yet. Share your presentations to see metrics.</p>
            ) : (
              <div className="space-y-2">
                {dashboard.topPresentations.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 transition-colors"
                    onClick={() => {
                      if (selectedPresId === p.id) {
                        setSelectedPresId(null)
                        setSelectedAnalytics(null)
                      } else {
                        loadPresentationDetail(p.id)
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xs text-gray-500 w-5 text-right shrink-0">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{p.title}</p>
                        <p className="text-[10px] text-gray-500">
                          {p.lastViewedAt ? `Last viewed ${formatDate(p.lastViewedAt)}` : 'No views yet'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
                      <span className="text-blue-400">{formatNumber(p.totalViews)} views</span>
                      <span>{formatNumber(p.uniqueViewers)} viewers</span>
                      <span>{p.avgTimePerSlideSec}s/slide</span>
                      <span className="text-gray-600">{selectedPresId === p.id ? '▼' : '▶'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Presentation Detail */}
          {selectedAnalytics && selectedPresId && (
            <div className="card p-4 space-y-4">
              <h2 className="text-sm font-semibold text-white mb-2">Presentation Details</h2>
              {detailLoading ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : (
                <>
                  {/* Stats row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Views</p>
                      <p className="text-lg font-bold text-white">{formatNumber(selectedAnalytics.totalViews)}</p>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Unique Viewers</p>
                      <p className="text-lg font-bold text-white">{formatNumber(selectedAnalytics.uniqueViewers)}</p>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Avg Time / Slide</p>
                      <p className="text-lg font-bold text-white">{formatDuration(selectedAnalytics.avgTimePerSlideMs)}</p>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Sessions</p>
                      <p className="text-lg font-bold text-white">{formatNumber(selectedAnalytics.totalSessions)}</p>
                    </div>
                  </div>

                  {/* Slide Popularity */}
                  {selectedAnalytics.slidePopularity.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-2">Slide Popularity</h3>
                      <div className="space-y-1">
                        {selectedAnalytics.slidePopularity.map((s) => {
                          const maxViews = Math.max(...selectedAnalytics.slidePopularity.map((x) => x.totalViews), 1)
                          const barWidth = (s.totalViews / maxViews) * 100
                          return (
                            <div key={s.slideIndex} className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 w-8 text-right shrink-0">
                                Slide {s.slideIndex + 1}
                              </span>
                              <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
                                <div
                                  className="h-full bg-blue-500/70 rounded-full flex items-center px-2 text-[10px] text-white/80"
                                  style={{ width: `${Math.max(barWidth, 5)}%` }}
                                >
                                  {s.totalViews > 0 && s.totalViews}
                                </div>
                              </div>
                              <span className="text-[10px] text-gray-500 w-16 shrink-0">
                                {s.uniqueViewers} viewers
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent Sessions */}
                  {selectedAnalytics.recentSessions.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-2">Recent Sessions</h3>
                      <div className="space-y-1 text-xs text-gray-400">
                        {selectedAnalytics.recentSessions.slice(0, 10).map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-1.5 bg-gray-800/50 rounded">
                            <div className="flex items-center gap-3">
                              <span className="text-blue-400">{s.viewerId}</span>
                              <span>{formatDate(s.startedAt)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span>{formatDuration(s.durationMs)}</span>
                              <span>{s.slidesViewed}/{s.totalSlides} slides</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* All Presentations List */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-white mb-3">All Presentations</h2>
            {dashboard.presentations.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No presentations yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                      <th className="text-left py-2 pr-4">Title</th>
                      <th className="text-right py-2 px-2">Views</th>
                      <th className="text-right py-2 px-2">Viewers</th>
                      <th className="text-right py-2 px-2">Sessions</th>
                      <th className="text-right py-2 px-2">Avg s/Slide</th>
                      <th className="text-right py-2 pl-2">Last Viewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.presentations.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                        onClick={() => {
                          if (selectedPresId === p.id) {
                            setSelectedPresId(null)
                            setSelectedAnalytics(null)
                          } else {
                            loadPresentationDetail(p.id)
                          }
                        }}
                      >
                        <td className="py-2 pr-4">
                          <span className="text-white font-medium">{p.title}</span>
                        </td>
                        <td className="text-right py-2 px-2 text-blue-400">{formatNumber(p.totalViews)}</td>
                        <td className="text-right py-2 px-2">{formatNumber(p.uniqueViewers)}</td>
                        <td className="text-right py-2 px-2">{formatNumber(p.totalSessions)}</td>
                        <td className="text-right py-2 px-2">{p.avgTimePerSlideSec}</td>
                        <td className="text-right py-2 pl-2 text-gray-500">
                          {p.lastViewedAt ? formatDate(p.lastViewedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
