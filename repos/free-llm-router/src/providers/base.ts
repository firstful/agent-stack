import { ChatCompletionRequest, ChatCompletionResponse, ModelInfo } from '../types.js';

export interface Provider {
  readonly name: string;
  readonly config: import('../types.js').ProviderConfig;

  chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  streamChat(req: ChatCompletionRequest): AsyncGenerator<string>;
  listModels(): Promise<ModelInfo[]>;
  translateRequest(req: ChatCompletionRequest): Record<string, unknown>;
  parseResponse(raw: unknown): ChatCompletionResponse;
  parseStreamChunk(raw: string): string | null;
  supportsReasoning(): boolean;
}

export abstract class BaseProvider implements Provider {
  abstract readonly name: string;
  abstract readonly config: import('../types.js').ProviderConfig;

  abstract translateRequest(req: ChatCompletionRequest): Record<string, unknown>;
  abstract parseResponse(raw: unknown): ChatCompletionResponse;
  abstract parseStreamChunk(raw: string): string | null;

  supportsReasoning(): boolean {
    return true;
  }

  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = this.translateRequest(req);
    const url = `${this.config.baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      const text = await res.text();
      const retryAfter = res.headers.get('Retry-After') || '';
      throw new Error(`${this.name} API error ${res.status}: ${text}${retryAfter ? ` [retry-after=${retryAfter}]` : ''}`);
    }

    return this.parseResponse(await res.json());
  }

  async *streamChat(req: ChatCompletionRequest): AsyncGenerator<string> {
    const body = this.translateRequest(req);
    const url = `${this.config.baseUrl}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!res.ok) {
      const text = await res.text();
      const retryAfter = res.headers.get('Retry-After') || '';
      throw new Error(`${this.name} API error ${res.status}: ${text}${retryAfter ? ` [retry-after=${retryAfter}]` : ''}`);
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
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        const chunk = this.parseStreamChunk(data);
        if (chunk) yield chunk;
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.config.models;
  }
}
