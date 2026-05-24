import { describe, it, expect } from "vitest";
import { buildLLMPrompts, parseLLMResponse } from "../lib/llm-prompt";

describe("buildLLMPrompts", () => {
  const baseInput = {
    energy: "thoughtful" as const,
    impulseTitle: "Respond to Tech Alliance",
    impulseDescription: "They proposed a joint standard.",
    draftThread: [
      { username: "alice", content: "I think we should agree broadly." },
      { username: "bob", content: "But push back on the timeline." },
    ],
  };

  it("includes energy instruction in system prompt", () => {
    const { systemPrompt } = buildLLMPrompts(baseInput);
    expect(systemPrompt).toContain("thoughtful");
    expect(systemPrompt).toContain("nuance");
  });

  it.each(["snarky", "funny", "mixed", "thoughtful"] as const)(
    "injects %s energy variant",
    (energy) => {
      const { systemPrompt } = buildLLMPrompts({ ...baseInput, energy });
      expect(systemPrompt).toContain(
        energy === "snarky"
          ? "sharp wit"
          : energy === "funny"
          ? "humor"
          : energy === "mixed"
          ? "natural"
          : "nuance"
      );
    }
  );

  it("includes banned words in system prompt", () => {
    const { systemPrompt } = buildLLMPrompts({
      ...baseInput,
      bannedWords: ["badword1", "badword2"],
    });
    expect(systemPrompt).toContain("badword1");
    expect(systemPrompt).toContain("badword2");
  });

  it("deduplicates banned words", () => {
    const { systemPrompt } = buildLLMPrompts({
      ...baseInput,
      bannedWords: ["bad", "bad", "worse"],
    });
    expect(systemPrompt).toContain("bad, worse");
  });

  it("includes content moderation rules", () => {
    const { systemPrompt } = buildLLMPrompts(baseInput);
    expect(systemPrompt).toContain("hate speech");
    expect(systemPrompt).toContain("violence");
    expect(systemPrompt).toContain("harass");
  });

  it("includes draft thread in user prompt", () => {
    const { userPrompt } = buildLLMPrompts(baseInput);
    expect(userPrompt).toContain("alice");
    expect(userPrompt).toContain("agree broadly");
    expect(userPrompt).toContain("bob");
    expect(userPrompt).toContain("push back");
  });

  it("includes impulse context in user prompt", () => {
    const { userPrompt } = buildLLMPrompts(baseInput);
    expect(userPrompt).toContain("Respond to Tech Alliance");
    expect(userPrompt).toContain("They proposed a joint standard.");
  });

  it("includes target group if provided", () => {
    const { userPrompt } = buildLLMPrompts({
      ...baseInput,
      targetGroupName: "Tech Alliance",
    });
    expect(userPrompt).toContain("Tech Alliance");
  });

  it("requests 2-3 candidates wrapped in candidate tags", () => {
    const { systemPrompt } = buildLLMPrompts(baseInput);
    expect(systemPrompt).toContain("<candidate>");
    expect(systemPrompt).toContain("2-3");
  });

  it("handles empty draft thread", () => {
    const { userPrompt } = buildLLMPrompts({
      ...baseInput,
      draftThread: [],
    });
    expect(userPrompt).not.toContain("Draft thread");
  });
});

describe("parseLLMResponse", () => {
  it("extracts candidate from simple response", () => {
    const raw = "<candidate>We support the proposal.</candidate>";
    expect(parseLLMResponse(raw)).toEqual(["We support the proposal."]);
  });

  it("extracts multiple candidates", () => {
    const raw = [
      "<candidate>Option one.</candidate>",
      "<candidate>Option two.</candidate>",
    ].join("\n");
    const result = parseLLMResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Option one.");
    expect(result[1]).toBe("Option two.");
  });

  it("strips whitespace around candidate content", () => {
    const raw = "<candidate>  \nHello  \n</candidate>";
    expect(parseLLMResponse(raw)).toEqual(["Hello"]);
  });

  it("returns empty array when no candidates found", () => {
    expect(parseLLMResponse("No tags here")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseLLMResponse("")).toEqual([]);
  });

  it("skips empty candidates", () => {
    const raw = "<candidate></candidate><candidate>Real</candidate>";
    expect(parseLLMResponse(raw)).toEqual(["Real"]);
  });

  it("handles multiline candidates with paragraph breaks", () => {
    const raw = "<candidate>Para one.\n\nPara two.</candidate>";
    expect(parseLLMResponse(raw)).toEqual(["Para one.\n\nPara two."]);
  });

  it("handles up to 5 candidates gracefully", () => {
    const candidates = Array.from(
      { length: 5 },
      (_, i) => `<candidate>Option ${i + 1}.</candidate>`
    ).join("\n");
    expect(parseLLMResponse(candidates)).toHaveLength(5);
  });
});
