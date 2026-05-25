import { useState } from 'react'
import { authClient } from '../lib/auth-client'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export function Home() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [signInError, setSignInError] = useState('')

  const handleSignIn = async () => {
    setSignInError('')
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  useEffect(() => {
    if (session) navigate('/editor', { replace: true })
  }, [session, navigate])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="flex items-center justify-end px-6 py-4">
        {isPending ? (
          <span className="text-xs text-gray-500">...</span>
        ) : session ? null : (
          <button onClick={handleSignIn} className="btn btn-primary text-sm">
            Sign In with Google
          </button>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="max-w-2xl">
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
            Chat with the AI to build slides, apply custom themes,
            and export professional decks.
          </p>
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-4">
              {isPending ? (
                <span className="text-gray-500">Loading...</span>
              ) : session ? (
                <button onClick={() => navigate('/editor')} className="btn btn-primary text-base px-6 py-3">
                  Go to Editor
                </button>
              ) : (
                <>
                  <button onClick={handleSignIn} className="btn btn-primary text-base px-6 py-3">
                    Get Started
                  </button>
                  <span className="text-gray-600 text-sm">or</span>
                  <button onClick={handleSignIn} className="btn btn-secondary text-base px-6 py-3">
                    Sign In
                  </button>
                </>
              )}
            </div>
            {signInError && (
              <p className="text-red-400 text-sm">{signInError}</p>
            )}
          </div>
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
