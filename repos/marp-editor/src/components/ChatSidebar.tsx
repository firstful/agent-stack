import { useState, useRef, useEffect } from 'react'
import { useStore } from '../lib/store'
import { sendChat } from '../lib/api'
import { generateId } from '../lib/cookies'
import { GenerateDeckForm } from './GenerateDeckForm'
import { SlideOutline } from './SlideOutline'
import { SlideThumbnail } from './SlideThumbnail'
import { renderSlideToHtml } from '../lib/marp'
import type { ChatMessage, ToolCallInfo } from '../types'

function ToolCallBadge({ toolCall }: { toolCall: ToolCallInfo }) {
  const label = toolCall.type === 'edit_markdown' ? 'Edited slides'
    : toolCall.type === 'edit_css' ? 'Edited CSS'
    : toolCall.type === 'apply_theme' ? 'Applied theme'
    : toolCall.type === 'focus_slide' ? 'Focused slide'
    : toolCall.type === 'get_state' ? 'Read state'
    : `Called ${toolCall.type}`

  return (
    <div className="chat-msg-system-tool">
      <span className="text-[10px] opacity-70">🔧</span> {label}
    </div>
  )
}

export function ChatSidebar() {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const {
    messages, addMessage, markdown, css, slides, renderedCss,
    setMarkdown, setCss, setCurrentSlide, setLayout,
    isGenerating, setIsGenerating, layout, showOutline, setShowOutline,
    showGenerateDeck, setShowGenerateDeck,
    model, setModel, balance, setBalance,
  } = useStore()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || isGenerating) return

    setInput('')

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setIsGenerating(true)

    try {
      const history = messages
        .filter((m) => m.role !== 'system' && !m.toolCalls)
        .slice(-5)
        .map((m) => ({
          role: m.role,
          content: m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content,
        }))

      const res = await sendChat({
        message: msg,
        markdown,
        css,
        history,
        model,
      })

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: res.message,
        timestamp: Date.now(),
      }

      const toolCalls = res.toolCalls || []

      // Process tool calls
      for (const tc of toolCalls) {
        if (tc.type === 'focus_slide') {
          const slideIndex = tc.args.slideIndex as number
          if (typeof slideIndex === 'number' && slides[slideIndex]) {
            setCurrentSlide(slideIndex)
            assistantMsg.attachment = {
              slideIndex,
              slideHtml: slides[slideIndex],
              css: renderedCss,
            }
          }
        }
      }

      addMessage(assistantMsg)

      // Add tool call badges as system messages
      for (const tc of toolCalls) {
        if (tc.type !== 'focus_slide') {
          addMessage({
            id: generateId(),
            role: 'system',
            content: '',
            timestamp: Date.now(),
            toolCalls: [tc],
          })
        }
      }

      if (res.markdown) setMarkdown(res.markdown)
      if (res.css) setCss(res.css)
      if ((res as any).balance !== undefined) setBalance((res as any).balance)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to get response'
      addMessage({
        id: generateId(),
        role: 'system',
        content: `Error: ${errMsg}`,
        timestamp: Date.now(),
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleThumbnailClick = (slideIndex: number) => {
    setCurrentSlide(slideIndex)
    if (layout === 'chat') {
      setLayout('fullscreen')
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-300">Chat</h2>
          <button
            className={`btn-ghost btn text-[10px] px-1.5 py-0.5 ${showOutline ? 'text-blue-400' : 'text-gray-600'}`}
            onClick={() => setShowOutline(!showOutline)}
            title="Toggle slide outline"
          >
            Outline
          </button>
          <button
            className={`btn-ghost btn text-[10px] px-1.5 py-0.5 ${showGenerateDeck ? 'text-green-400' : 'text-gray-600'}`}
            onClick={() => setShowGenerateDeck(!showGenerateDeck)}
            title="Generate a deck from a natural language prompt"
          >
            Generate
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 whitespace-nowrap">{balance}¢</span>
          <button
            className={`btn-ghost btn text-[10px] px-1.5 ${model === 'flash' ? 'text-green-400' : 'text-gray-600'}`}
            onClick={() => setModel(model === 'flash' ? 'pro' : 'flash')}
            title="Flash: 1¢/msg · Pro: 5¢/msg"
          >
            {model === 'flash' ? '⚡Flash' : '⭐Pro'}
          </button>
        </div>
        <div className="flex gap-1">
          <button
            className={`btn-ghost btn text-xs ${layout === 'chat' ? 'text-blue-400' : ''}`}
            onClick={() => setLayout('chat')}
            title="Chat + Preview"
          >
            Split
          </button>
          <button
            className={`btn-ghost btn text-xs ${layout === 'split' ? 'text-blue-400' : ''}`}
            onClick={() => setLayout('split')}
            title="Markdown + Preview"
          >
            Code
          </button>
          <button
            className={`btn-ghost btn text-xs ${layout === 'fullscreen' ? 'text-blue-400' : ''}`}
            onClick={() => setLayout('fullscreen')}
            title="Fullscreen"
          >
            Full
          </button>
        </div>
      </div>

      {/* Slide Outline */}
      <SlideOutline />

      {/* Generate Deck Form */}
      {showGenerateDeck && <GenerateDeckForm />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col">
            {m.role === 'system' ? (
              m.toolCalls ? (
                <ToolCallBadge toolCall={m.toolCalls[0]} />
              ) : (
                <div className="chat-msg-system">{m.content}</div>
              )
            ) : (
              <div className={m.role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant'}>
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                {m.attachment && (
                  <SlideThumbnail
                    slideIndex={m.attachment.slideIndex}
                    slideHtml={m.attachment.slideHtml}
                    css={m.attachment.css}
                    onClick={() => handleThumbnailClick(m.attachment!.slideIndex)}
                  />
                )}
              </div>
            )}
          </div>
        ))}
        {isGenerating && (
          <div className="chat-msg-assistant">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Type a message... (/)"
            className="input flex-1 resize-none text-sm"
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={isGenerating || !input.trim()}
            className="btn btn-primary self-end"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
