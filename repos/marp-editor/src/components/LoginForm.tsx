import { useState } from 'react'
import { authClient } from '../lib/auth-client'

export function LoginForm() {
  const { data: session, isPending } = authClient.useSession()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogout = async () => {
    await authClient.signOut()
  }

  if (isPending) {
    return <span className="text-xs text-gray-500">...</span>
  }

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 hidden sm:inline">{session.user.name || session.user.email}</span>
        <button onClick={handleLogout} className="btn-ghost btn text-xs">Logout</button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="btn-ghost btn text-xs flex items-center gap-1"
        onClick={() => {
          setLoading(true)
          authClient.signIn.social({ provider: 'google' })
            .catch(err => {
              setError(err instanceof Error ? err.message : 'Sign in failed')
            })
            .finally(() => setLoading(false))
        }}
        disabled={loading}
        title="Sign in with Google"
      >
        {loading ? '...' : <span className="text-blue-400">G</span>}
      </button>
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  )
}
