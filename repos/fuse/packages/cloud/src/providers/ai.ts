/**
 * providers/ai.ts — LLM provider adapters.
 *
 * All adapters normalise to the OpenAI-compatible streaming chat completions
 * format.  Most cloud providers (Bedrock, Vertex AI, Azure OpenAI) support
 * this natively or via a gateway.
 */

import type { AiProvider } from "./index.js";

// ── OpenAI-compatible (generic) ──────────────────────────────────────────

class OpenAICompatibleProvider implements AiProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
    this.apiKey = process.env.AI_API_KEY ?? "";
  }

  async complete(prompt: string, options?: Record<string, unknown>): Promise<string> {
    const model = (options?.model as string) ?? process.env.AI_MODEL ?? "gpt-4o";
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`AI provider error: ${resp.status} ${await resp.text()}`);
    const json = (await resp.json()) as any;
    return json.choices?.[0]?.message?.content ?? "";
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createAiProvider(providerName: string): AiProvider {
  switch (providerName) {
    case "aws-bedrock":
    case "gcp-vertex":
    case "azure-openai":
      // TODO: implement native SDK adapters for these
      // For now they all support OpenAI-compatible endpoints
    default:
      return new OpenAICompatibleProvider();
  }
}
