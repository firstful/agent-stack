import { BaseProvider } from './base.js';
import { ChatCompletionRequest, ChatCompletionResponse, ChatMessage, ProviderConfig, ModelInfo } from '../types.js';

const REASONING_BUDGETS: Record<string, number | undefined> = {
  high: 32000,
  medium: 8192,
  low: 2048,
};

function normalizeText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object' && 'text' in c) return String(c.text);
      return '';
    }).join('');
  }
  return String(content);
}

export class GeminiProvider extends BaseProvider {
  readonly name: string;
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.name = config.key;
    this.config = config;
  }

  supportsReasoning(): boolean {
    return false;
  }

  private convertMessages(req: ChatCompletionRequest): Record<string, unknown>[] {
    const contents: Record<string, unknown>[] = [];
    let pendingToolParts: Record<string, unknown>[] = [];

    const flushPending = (role: string) => {
      if (pendingToolParts.length > 0) {
        contents.push({ role, parts: pendingToolParts });
        pendingToolParts = [];
      }
    };

    for (const m of req.messages) {
      if (m.role === 'system') continue;

      if (m.role === 'tool') {
        pendingToolParts.push({
          functionResponse: {
            name: m.name || m.tool_call_id || 'unknown',
            response: { content: normalizeText(m.content) },
          },
        });
        continue;
      }

      if (m.role === 'assistant' && m.tool_calls) {
        flushPending('model');
        const parts: Record<string, unknown>[] = [];
        const txt = normalizeText(m.content);
        if (txt) parts.push({ text: txt });
        for (const tc of m.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
        contents.push({ role: 'model', parts });
        continue;
      }

      flushPending(m.role === 'assistant' ? 'model' : 'user');
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: normalizeText(m.content) }],
      });
    }

    flushPending('user');
    return contents;
  }

  translateRequest(req: ChatCompletionRequest): Record<string, unknown> {
    const systemInstruction = req.messages.find(m => m.role === 'system');
    const genConfig: Record<string, unknown> = {
      temperature: req.temperature,
      maxOutputTokens: req.max_tokens,
      topP: req.top_p,
      stopSequences: req.stop ? (Array.isArray(req.stop) ? req.stop : [req.stop]) : undefined,
    };

    const reasoningEffort = (req as any).reasoning_effort as string | undefined;
    if (reasoningEffort && reasoningEffort !== 'none' && reasoningEffort !== 'off') {
      const budget = REASONING_BUDGETS[reasoningEffort];
      if (budget) genConfig.thinkingBudget = budget;
    }

    const body: Record<string, unknown> = {
      contents: this.convertMessages(req),
      generationConfig: genConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: normalizeText(systemInstruction.content) }] };
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = [{
        functionDeclarations: req.tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];

      if (req.tool_choice) {
        let mode = 'AUTO';
        if (req.tool_choice === 'none') mode = 'NONE';
        else if (req.tool_choice === 'auto') mode = 'AUTO';
        else if (req.tool_choice === 'required') mode = 'ANY';
        else if (typeof req.tool_choice === 'object' && req.tool_choice.type === 'function') mode = 'ANY';
        body.toolConfig = { functionCallingConfig: { mode } };
      }
    }

    return body;
  }

  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = this.config.models[0]?.id || 'gemini-2.5-flash';
    const url = `${this.config.baseUrl}/models/${modelId}:generateContent?key=${this.config.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.translateRequest(req)),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      const text = await res.text();
      const retryAfter = res.headers.get('Retry-After') || '';
      throw new Error(`Gemini API error ${res.status}: ${text}${retryAfter ? ` [retry-after=${retryAfter}]` : ''}`);
    }

    return this.parseResponse(await res.json() as Record<string, unknown>);
  }

  async *streamChat(req: ChatCompletionRequest): AsyncGenerator<string> {
    const modelId = this.config.models[0]?.id || 'gemini-2.5-flash';
    const url = `${this.config.baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.translateRequest(req)),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      const text = await res.text();
      const retryAfter = res.headers.get('Retry-After') || '';
      throw new Error(`Gemini API error ${res.status}: ${text}${retryAfter ? ` [retry-after=${retryAfter}]` : ''}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const chunk = this.parseStreamChunk(trimmed.slice(6));
        if (chunk) yield chunk;
      }
    }
  }

  parseResponse(raw: unknown): ChatCompletionResponse {
    const r = raw as Record<string, unknown>;
    const candidates = r.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    const text = parts?.filter(p => p.text).map(p => p.text as string).join('') || null;
    const functionCalls = parts?.filter(p => p.functionCall).map(p => p.functionCall as Record<string, unknown>) || [];
    const finishReason = candidates?.[0]?.finishReason as string | undefined;
    const ts = Math.floor(Date.now() / 1000);

    const message: ChatMessage = { role: 'assistant', content: text || null };

    if (functionCalls.length > 0) {
      message.tool_calls = functionCalls.map((fc, i) => ({
        id: `call_gemini_${ts}_${i}`,
        type: 'function' as const,
        function: {
          name: fc.name as string,
          arguments: JSON.stringify(fc.args),
        },
      }));
    }

    let mappedFinish: 'stop' | 'length' | 'tool_calls' | null = null;
    if (finishReason === 'STOP') mappedFinish = 'stop';
    else if (finishReason === 'MAX_TOKENS') mappedFinish = 'length';
    else if (finishReason === 'FUNCTION_CALL') mappedFinish = 'tool_calls';

    return {
      id: `gemini-${ts}`,
      object: 'chat.completion',
      created: ts,
      model: (r.model as string) || 'gemini',
      choices: [{
        index: 0,
        message,
        finish_reason: mappedFinish,
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  parseStreamChunk(raw: string): string | null {
    try {
      const r = JSON.parse(raw) as Record<string, unknown>;
      const candidates = r.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (!parts?.length) return null;

      const functionCallPart = parts.find(p => p.functionCall);
      if (functionCallPart) {
        const fc = functionCallPart.functionCall as Record<string, unknown>;
        const ts = Math.floor(Date.now() / 1000);
        const toolCall = {
          id: `call_gemini_${ts}`,
          type: 'function' as const,
          function: { name: fc.name as string, arguments: JSON.stringify(fc.args) },
        };
        return JSON.stringify({ tool_calls: [toolCall] });
      }

      return parts.map(p => p.text as string).join('') || null;
    } catch {
      return null;
    }
  }
}
