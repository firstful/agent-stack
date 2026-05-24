export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ChatRequest {
  message: string
  markdown: string
  css: string
  history: { role: string; content: string }[]
}

export interface ToolCall {
  id: string
  type: 'edit_markdown' | 'edit_css' | 'get_state'
  arguments: Record<string, unknown>
}

export interface ChatResponse {
  message: string
  markdown: string
  css: string
  toolCalls: ToolCall[]
}
