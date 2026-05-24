import { BaseProvider } from './base.js';
import { ChatCompletionRequest, ChatCompletionResponse, ProviderConfig, ModelInfo } from '../types.js';

export class OpenAICompatProvider extends BaseProvider {
  readonly name: string;
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super();
    this.name = config.key;
    this.config = config;
  }

    translateRequest(req: ChatCompletionRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: req.model || this.config.models[0]?.id,
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      top_p: req.top_p,
      frequency_penalty: req.frequency_penalty,
      presence_penalty: req.presence_penalty,
      stop: req.stop,
      stream: req.stream,
      user: req.user,
      tools: req.tools ?? [],
    };
    if (req.tool_choice !== undefined) payload.tool_choice = req.tool_choice;
    return payload;
  }

  parseResponse(raw: unknown): ChatCompletionResponse {
    const r = raw as Record<string, unknown>;
    return r as unknown as ChatCompletionResponse;
  }

  parseStreamChunk(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) return null;
      const delta = choices[0].delta as Record<string, unknown> | undefined;
if (delta?.tool_calls) {
          return JSON.stringify({ tool_calls: delta.tool_calls });
        }
        if (delta?.role) {
          return JSON.stringify({ role: delta.role });
        }
        return delta?.content !== undefined ? JSON.stringify({ content: delta.content }) : null;
    } catch {
return null;
    }
  }
}
