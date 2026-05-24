import type { GroupEnergy } from "../index";

const ENERGY_SYSTEM_PROMPTS: Record<GroupEnergy, string> = {
  thoughtful:
    "Frame the response as a thoughtful, considered position. Prioritize nuance and depth over brevity. Acknowledge counterarguments where appropriate.",
  snarky:
    "Frame the response with sharp wit and biting humor. Be clever and cutting, but remain substantive. Avoid mean-spiritedness — snark should illuminate, not just attack.",
  funny:
    "Frame the response with humor and levity. Use wit to make the point memorable. Avoid forced jokes — humor should serve the substance, not replace it.",
  mixed:
    "Frame the response naturally. Let the tone emerge from the content. Be direct, clear, and human. Do not force a particular energy.",
};

const DEFAULT_BANNED_WORDS = [
  "slur_placeholder_1",
  "slur_placeholder_2",
];

const MODERATION_RULES = [
  "Do not use hate speech, slurs, or personal attacks.",
  "Do not promote violence or illegal activity.",
  "Do not harass or bully individuals.",
  "Do not generate spam, gibberish, or low-effort content.",
  "Do not impersonate other groups or individuals.",
];

export interface LLMInput {
  energy: GroupEnergy;
  impulseTitle: string;
  impulseDescription: string;
  draftThread: { username: string; content: string }[];
  targetGroupName?: string;
  bannedWords?: string[];
}

export interface LLMPrompts {
  systemPrompt: string;
  userPrompt: string;
}

export function buildLLMPrompts(input: LLMInput): LLMPrompts {
  const {
    energy,
    impulseTitle,
    impulseDescription,
    draftThread,
    targetGroupName,
    bannedWords = DEFAULT_BANNED_WORDS,
  } = input;

  const energyInstruction = ENERGY_SYSTEM_PROMPTS[energy];

  const bannedWordsList = [...new Set(bannedWords)].join(", ");

  const systemPrompt = [
    "You are a response composer for a group deliberation platform called Groupthink.",
    "Your job is to synthesize a group's internal discussion into a polished public response.",
    "",
    energyInstruction,
    "",
    "CONTENT RULES:",
    ...MODERATION_RULES.map((r) => `- ${r}`),
    `- Banned words: ${bannedWordsList}`,
    "- Output exactly 2-3 distinct candidate responses, each wrapped in <candidate></candidate> tags.",
    "- Each candidate should be 1-3 paragraphs (50-300 words).",
    "- Return only the candidates, no commentary or meta-text.",
  ].join("\n");

  const draftText = draftThread
    .map((d) => `${d.username}: ${d.content}`)
    .join("\n");

  const userPrompt = [
    `Impulse: ${impulseTitle}`,
    impulseDescription ? `\nContext: ${impulseDescription}` : "",
    targetGroupName ? `\nAddressed to: ${targetGroupName}` : "",
    draftThread.length > 0 ? `\n--- Draft thread ---\n${draftText}` : "",
    "\n---\nGenerate candidates:",
  ]
    .filter(Boolean)
    .join("\n");

  return { systemPrompt, userPrompt };
}

export function parseLLMResponse(raw: string): string[] {
  const candidates: string[] = [];
  const regex = /<candidate>([\s\S]*?)<\/candidate>/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const content = match[1].trim();
    if (content.length > 0) {
      candidates.push(content);
    }
  }
  return candidates;
}
