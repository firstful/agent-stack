/**
 * providers/ai.ts — LLM provider adapters.
 *
 * All adapters normalise to the OpenAI-compatible streaming chat completions
 * format.  Most cloud providers (Bedrock, Vertex AI, Azure OpenAI) support
 * this natively or via a gateway.
 */
// ── OpenAI-compatible (generic) ──────────────────────────────────────────
class OpenAICompatibleProvider {
    baseUrl;
    apiKey;
    constructor() {
        this.baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
        this.apiKey = process.env.AI_API_KEY ?? "";
    }
    async complete(prompt, options) {
        const model = options?.model ?? process.env.AI_MODEL ?? "gpt-4o";
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
        if (!resp.ok)
            throw new Error(`AI provider error: ${resp.status} ${await resp.text()}`);
        const json = (await resp.json());
        return json.choices?.[0]?.message?.content ?? "";
    }
}
// ── Factory ──────────────────────────────────────────────────────────────
export function createAiProvider(providerName) {
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
//# sourceMappingURL=ai.js.map