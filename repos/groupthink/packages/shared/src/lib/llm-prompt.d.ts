import type { GroupEnergy } from "../index";
export interface LLMInput {
    energy: GroupEnergy;
    impulseTitle: string;
    impulseDescription: string;
    draftThread: {
        username: string;
        content: string;
    }[];
    targetGroupName?: string;
    bannedWords?: string[];
}
export interface LLMPrompts {
    systemPrompt: string;
    userPrompt: string;
}
export declare function buildLLMPrompts(input: LLMInput): LLMPrompts;
export declare function parseLLMResponse(raw: string): string[];
//# sourceMappingURL=llm-prompt.d.ts.map