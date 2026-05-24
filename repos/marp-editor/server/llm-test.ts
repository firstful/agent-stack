// Deterministic test LLM — returns preset responses in order

export interface TestLlmResponse {
  message: string
  markdown?: string
  css?: string
  focusSlideIndex?: number
}

interface InternalResponse extends TestLlmResponse {
  _returnsMarkdown: boolean
  _returnsCss: boolean
  _returnsFocusSlide: boolean
}

class TestLlmController {
  private responses: InternalResponse[] = []
  private index = 0
  private defaultResponse: InternalResponse = {
    message: 'I am a test LLM. I acknowledge your request.',
    _returnsMarkdown: false,
    _returnsCss: false,
    _returnsFocusSlide: false,
  }

  setResponses(responses: TestLlmResponse[]): void {
    this.responses = responses.map((r) => ({
      ...r,
      message: r.message || 'Test LLM response.',
      _returnsMarkdown: r.markdown !== undefined,
      _returnsCss: r.css !== undefined,
      _returnsFocusSlide: r.focusSlideIndex !== undefined,
    }))
    this.index = 0
  }

  reset(): void {
    this.responses = []
    this.index = 0
  }

  next(): TestLlmResponse {
    if (this.index < this.responses.length) {
      return this.responses[this.index++]
    }
    return this.defaultResponse
  }
}

export const testLlm = new TestLlmController()

export async function testProcessChat(
  _message: string,
  currentMarkdown: string,
  currentCss: string,
  _history: { role: string; content: string }[]
): Promise<{ reply: string; markdown: string; css: string; slideBundle?: unknown; toolCalls: { id: string; type: string; args: Record<string, unknown> }[] }> {
  const response = testLlm.next()
  const toolCalls: { id: string; type: string; args: Record<string, unknown> }[] = []

  if (response.markdown !== undefined) {
    toolCalls.push({ id: 'test-tc-1', type: 'edit_markdown', args: { markdown: response.markdown } })
  }
  if (response.css !== undefined) {
    toolCalls.push({ id: 'test-tc-2', type: 'edit_css', args: { css: response.css } })
  }
  if (response.focusSlideIndex !== undefined) {
    toolCalls.push({ id: 'test-tc-3', type: 'focus_slide', args: { slideIndex: response.focusSlideIndex } })
  }

  return {
    reply: response.message,
    markdown: response.markdown ?? currentMarkdown,
    css: response.css ?? currentCss,
    toolCalls,
  }
}
