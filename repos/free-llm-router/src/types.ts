export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
  reasoning_effort?: string;
  tools?: ToolDefinition[];
  tool_choice?: string | { type: 'function'; function: { name: string } };
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { content?: string | null; role?: string; tool_calls?: ToolCall[] };
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }[];
}

export type ModelTier = 'default';

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: ('text' | 'image')[];
  parameterSize?: string;
}

export interface ProviderConfig {
  key: string;
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  timeout: number;
  priority: number;
  models: ModelInfo[];
}

export type ErrorCategory = 'transient' | 'config' | 'format' | 'rate_limit';

export interface ErrorRule {
  id: string;
  provider: string;
  category: ErrorCategory;
  pattern: string;
  flags: string;
  source: 'seed' | 'llm';
  description: string;
  createdAt: string;
}

export interface ProviderEntry {
  key: string;
  envKey: string;
  baseUrl: string;
  api: 'openai-completions' | 'gemini';
  priority?: number;
}

export interface ProviderState {
  key: string;
  health: 'unknown' | 'healthy' | 'degraded' | 'down' | 'unauthenticated' | 'error';
  lastHealthCheck: number;
  lastActiveAt: number;
  latencyMs: number[];
  cooldownUntil: number;
  modelCooldowns: Record<string, number>;
  consecutiveFailures: number;
}

export interface ProviderModelsCache {
  ttl: number;
  models: ModelInfo[];
}
