import { useState } from 'react'
import { authClient } from '../lib/auth-client'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export function Home() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setAuthError('')
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setLoading(true)
    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({ email, password, name: email.split('@')[0] })
        if (result.error) throw new Error(result.error.message || result.error.statusText || 'Sign up failed')
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) throw new Error(result.error.message || result.error.statusText || 'Sign in failed')
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) navigate('/editor', { replace: true })
  }, [session, navigate])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="max-w-md w-full">
          <div className="inline-flex items-center gap-3 mb-6">
            <svg viewBox="0 0 32 32" width="48" height="48">
              <rect width="32" height="32" rx="7" fill="#0ea5e9" />
              <path d="M6 10h20" stroke="white" stroke-width="2.2" stroke-linecap="round" />
              <path d="M6 16h14" stroke="white" stroke-width="2.2" stroke-linecap="round" />
              <path d="M6 22h8" stroke="white" stroke-width="2.2" stroke-linecap="round" />
            </svg>
            <h1 className="text-5xl font-bold text-white">TechDeck</h1>
          </div>
          <p className="text-xl text-gray-400 mb-8 leading-relaxed">
            Create beautiful, AI-powered presentations in minutes.
          </p>

          {isPending ? (
            <span className="text-gray-500">Loading...</span>
          ) : session ? (
            <button onClick={() => navigate('/editor')} className="btn btn-primary text-base px-6 py-3">
              Go to Editor
            </button>
          ) : (
            <div className="card text-left">
              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input w-full"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input w-full"
                    placeholder="password"
                    minLength={6}
                    required
                  />
                </div>
                {authError && (
                  <p className="text-red-400 text-sm">{authError}</p>
                )}
                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? '...' : isSignUp ? 'Sign Up' : 'Sign In'}
                </button>
              </form>

              <div className="flex items-center gap-2 my-4">
                <div className="flex-1 h-px bg-gray-800" />
                <span className="text-xs text-gray-600">or</span>
                <div className="flex-1 h-px bg-gray-800" />
              </div>

              <button onClick={handleGoogleSignIn} disabled={loading} className="btn btn-secondary w-full text-sm">
                Sign In with Google
              </button>

              <p className="text-center text-sm text-gray-500 mt-4">
                {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  onClick={() => { setIsSignUp(!isSignUp); setAuthError('') }}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {isSignUp ? 'Sign In' : 'Sign Up'}
                </button>
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-16 max-w-3xl w-full px-4">
          <div className="card text-center">
            <div className="text-3xl mb-2">🤖</div>
            <h3 className="text-white font-semibold mb-1">AI-Powered</h3>
            <p className="text-gray-500 text-sm">Generate slides from natural language descriptions</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-2">🎨</div>
            <h3 className="text-white font-semibold mb-1">Custom Themes</h3>
            <p className="text-gray-500 text-sm">Apply and customize themes with full CSS control</p>
          </div>
          <div className="card text-center">
            <div className="text-3xl mb-2">📐</div>
            <h3 className="text-white font-semibold mb-1">Real-time Preview</h3>
            <p className="text-gray-500 text-sm">See your slides rendered as you edit in 16:9 format</p>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-gray-600 text-sm">
        TechDeck &mdash; Built with MARP and AI
      </footer>
    </div>
  )
}
