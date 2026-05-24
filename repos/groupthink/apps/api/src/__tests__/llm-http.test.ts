import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { buildLLMPrompts, parseLLMResponse } from "@groupthink/shared/src/lib/llm-prompt";

const LLM_ENDPOINT = "https://api.openai.com";
const LLM_PATH = "/v1/chat/completions";

describe("LLM HTTP integration (nock-recorded)", () => {
  afterAll(() => {
    nock.cleanAll();
  });

  const input = {
    energy: "thoughtful" as const,
    impulseTitle: "Respond to Tech Alliance proposal",
    impulseDescription: "They proposed a joint API standard for cross-group messaging.",
    draftThread: [
      { username: "alice", content: "I think we should agree but clarify scope." },
      { username: "bob", content: "Scope is key — make it opt-in per group." },
      { username: "charlie", content: "And set a 90-day review cycle." },
    ],
    targetGroupName: "Tech Alliance",
    bannedWords: ["slur1", "slur2"],
  };

  function mockLLMResponse(
    content: string,
    status = 200
  ) {
    return nock(LLM_ENDPOINT)
      .post(LLM_PATH, (body) => {
        // Validate request shape
        expect(body).toHaveProperty("model");
        expect(body).toHaveProperty("messages");
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[1].role).toBe("user");
        expect(body.messages[0].content).toContain("thoughtful");
        expect(body.messages[1].content).toContain("Tech Alliance");
        return true;
      })
      .reply(status, {
        choices: [
          {
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 150 },
      });
  }

  it("sends prompt with correct structure and parses 3 candidates", async () => {
    const llmOutput = [
      "<candidate>We support the joint standard with clarified scope. Cross-group messaging should be opt-in, with a default-off setting for existing groups. This preserves autonomy while enabling interoperability.</candidate>",
      "<candidate>Agree in principle, but insist on a 90-day review cycle and sunset clause. The standard should evolve based on real usage patterns, not speculative design.</candidate>",
      "<candidate>Propose a phased rollout: pilot with 3 groups first, then open to all after review. This de-risks the initiative and builds confidence in the protocol.</candidate>",
    ].join("\n");

    mockLLMResponse(llmOutput);

    const { systemPrompt, userPrompt } = buildLLMPrompts(input);

    const response = await fetch(`${LLM_ENDPOINT}${LLM_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const raw = data.choices[0].message.content;
    const candidates = parseLLMResponse(raw);

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toContain("opt-in");
    expect(candidates[1]).toContain("90-day");
    expect(candidates[2]).toContain("phased");
  });

  it("handles single candidate response", async () => {
    const llmOutput =
      "<candidate>We agree to the proposal as written.</candidate>";

    mockLLMResponse(llmOutput);

    const { systemPrompt, userPrompt } = buildLLMPrompts(input);

    const response = await fetch(`${LLM_ENDPOINT}${LLM_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const raw = data.choices[0].message.content;
    const candidates = parseLLMResponse(raw);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBe("We agree to the proposal as written.");
  });

  it("handles malformed response with no candidate tags", async () => {
    const llmOutput =
      "I think you should just agree with them.";

    mockLLMResponse(llmOutput);

    const { systemPrompt, userPrompt } = buildLLMPrompts(input);

    const response = await fetch(`${LLM_ENDPOINT}${LLM_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const raw = data.choices[0].message.content;
    const candidates = parseLLMResponse(raw);

    expect(candidates).toHaveLength(0);
  });

  it("handles LLM timeout / error status", async () => {
    nock(LLM_ENDPOINT)
      .post(LLM_PATH)
      .reply(503, { error: { message: "Service Unavailable" } });

    const { systemPrompt, userPrompt } = buildLLMPrompts(input);

    const response = await fetch(`${LLM_ENDPOINT}${LLM_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.error.message).toBe("Service Unavailable");
  });

  it("validates request body has correct message roles", async () => {
    nock(LLM_ENDPOINT)
      .post(LLM_PATH, (body) => {
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[1].role).toBe("user");
        expect(body.messages).toHaveLength(2);
        return true;
      })
      .reply(200, {
        choices: [
          {
            message: {
              role: "assistant",
              content: "<candidate>OK.</candidate>",
            },
            finish_reason: "stop",
          },
        ],
      });

    const { systemPrompt, userPrompt } = buildLLMPrompts(input);

    const response = await fetch(`${LLM_ENDPOINT}${LLM_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    expect(response.ok).toBe(true);
  });
});
