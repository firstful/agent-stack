import { useState } from 'react'
import { useStore } from '../lib/store'
import { generateDeck as apiGenerateDeck } from '../lib/api'
import { generateId } from '../lib/cookies'
import type { ChatMessage } from '../types'

export function GenerateDeckForm() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const {
    addMessage, loadPresentation, css, setIsGenerating, balance, setBalance,
    model, setShowGenerateDeck,
  } = useStore()

  const handleGenerate = async () => {
    const trimmed = prompt.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError('')
    setIsGenerating(true)

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: `Generate a deck about: ${trimmed}`,
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    try {
      const result = await apiGenerateDeck({ prompt: trimmed, model })

      loadPresentation(result.markdown, result.css || css)

      if (result.balance !== undefined) setBalance(result.balance)

      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `✅ **${result.title}** — generated successfully. You can now edit and refine the slides.`,
        timestamp: Date.now(),
      })

      setPrompt('')
      setShowGenerateDeck(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deck generation failed'
      setError(msg)
      addMessage({
        id: generateId(),
        role: 'system',
        content: `Error: ${msg}`,
        timestamp: Date.now(),
      })
    } finally {
      setLoading(false)
      setIsGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }

  return (
    <div className="border-b border-gray-800 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          AI Deck Generator
        </span>
      </div>

      <div className="flex gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Create a 5-slide deck about Q3 earnings"
          className="input flex-1 resize-none text-sm"
          rows={2}
          disabled={loading}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className={`btn btn-primary text-xs px-4 py-1.5 ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              Generating
            </span>
          ) : (
            'Generate'
          )}
        </button>

        <button
          onClick={() => setShowGenerateDeck(false)}
          className="btn-ghost btn text-[10px] px-2 py-1 ml-auto"
          title="Close"
        >
          ✕
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-[11px]">{error}</p>
      )}
    </div>
  )
}
