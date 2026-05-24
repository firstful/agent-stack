/**
 * providers/ai.ts — LLM provider adapters.
 *
 * All adapters normalise to the OpenAI-compatible streaming chat completions
 * format.  Most cloud providers (Bedrock, Vertex AI, Azure OpenAI) support
 * this natively or via a gateway.
 */
import type { AiProvider } from "./index.js";
export declare function createAiProvider(providerName: string): AiProvider;
//# sourceMappingURL=ai.d.ts.map