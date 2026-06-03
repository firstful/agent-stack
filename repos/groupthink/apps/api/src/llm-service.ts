import { eq, and, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import type { RedisClientType } from "redis";
import * as schema from "@groupthink/db";
import { buildLLMPrompts, parseLLMResponse } from "@groupthink/shared";
import { fetchBannedWordList } from "./lifecycle";
import { logger as rootLogger } from "./logger";

// ── Config ──

const LLM_ENDPOINT =
  process.env.LLM_ENDPOINT ?? "https://api.openai.com/v1/chat/completions";
const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-4";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? "30_000");

// ── Logger ──

const log = rootLogger.child({ component: "llm-service" });

// ── Types ──

interface LLMServiceResult {
  success: boolean;
  candidates: string[];
  error?: string;
}

// ── Main ──

/**
 * Trigger LLM summarization for a single impulse in "summarizing" phase.
 *
 * Flow:
 * 1. Fetch impulse + drafts + group
 * 2. Fetch real banned words from DB
 * 3. Build prompts with content rules + banned words
 * 4. Call LLM provider
 * 5. Parse candidates into summaryCandidates table
 */
export async function runLLMSummarization(
  client: postgres.Sql,
  _redis: RedisClientType,
  impulseId: string
): Promise<LLMServiceResult> {
  const db = drizzle(client, { schema });

  try {
    // 1. Fetch impulse
    const impulse = await db.query.impulses.findFirst({
      where: (i, { eq }) => eq(i.id, impulseId),
      with: { group: true, targetGroup: true },
    });

    if (!impulse) {
      return { success: false, candidates: [], error: "impulse not found" };
    }
    if (impulse.status !== "summarizing") {
      return {
        success: false,
        candidates: [],
        error: `impulse status is ${impulse.status}, not summarizing`,
      };
    }

    // 2. Fetch drafts
    const drafts = await db.query.drafts.findMany({
      where: (d, { eq }) => eq(d.impulseId, impulseId),
      orderBy: (d, { asc }) => [d.createdAt],
      with: { user: true },
    });

    const draftThread = drafts.map((d) => ({
      username: d.user?.username ?? "unknown",
      content: d.content,
    }));

    // 3. Fetch real banned words from database (not hardcoded placeholders)
    const bannedWords = await fetchBannedWordList(db);

    // 4. Build prompts with content rules and real banned words
    const { systemPrompt, userPrompt } = buildLLMPrompts({
      energy: (impulse.group?.energy as any) ?? "mixed",
      impulseTitle: impulse.title,
      impulseDescription: impulse.description ?? "",
      draftThread,
      targetGroupName: impulse.targetGroup?.name,
      bannedWords: bannedWords.length > 0 ? bannedWords : undefined,
    });

    // 5. Call LLM provider
    const result = await callLLM(systemPrompt, userPrompt);

    if (!result.success) {
      return result;
    }

    // 6. Parse and store candidates
    const candidates = parseLLMResponse(result.rawContent ?? "");

    if (candidates.length === 0) {
      // Fallback: generate a simple candidate based on the top draft
      const fallback = generateFallbackCandidate(draftThread, impulse);
      if (fallback) {
        await db.insert(schema.summaryCandidates).values({
          impulseId,
          content: fallback,
        });
        log(
          `impulse ${impulseId.slice(0, 8)}: LLM returned 0 candidates, ` +
            `inserted fallback candidate`
        );
        return { success: true, candidates: [fallback] };
      }

      return {
        success: false,
        candidates: [],
        error: "LLM returned no candidates and no fallback available",
      };
    }

    for (const content of candidates) {
      await db.insert(schema.summaryCandidates).values({
        impulseId,
        content,
      });
    }

    log(
      `impulse ${impulseId.slice(0, 8)}: generated ${candidates.length} ` +
        `candidates from LLM (banned words: ${bannedWords.length})`
    );

    return { success: true, candidates };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`summarization failed for ${impulseId.slice(0, 8)}`, { error: msg });

    // Fallback: try to generate a simple candidate
    try {
      const impulse = await db.query.impulses.findFirst({
        where: (i, { eq }) => eq(i.id, impulseId),
      });
      if (impulse) {
        const drafts = await db.query.drafts.findMany({
          where: (d, { eq }) => eq(d.impulseId, impulseId),
          orderBy: (d, { asc }) => [d.createdAt],
          with: { user: true },
        });
        const thread = drafts.map((d) => ({
          username: d.user?.username ?? "unknown",
          content: d.content,
        }));
        const fallback = generateFallbackCandidate(thread, impulse);
        if (fallback) {
          await db.insert(schema.summaryCandidates).values({
            impulseId,
            content: fallback,
          });
          return { success: true, candidates: [fallback] };
        }
      }
    } catch {
      // Ignore fallback errors
    }

    return { success: false, candidates: [], error: msg };
  }
}

// ── HTTP Call ──

async function callLLM(
  systemPrompt: string,
  userPrompt: string
): Promise<{ success: boolean; rawContent?: string; error?: string }> {
  if (!LLM_API_KEY) {
    return { success: false, error: "LLM_API_KEY not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        success: false,
        error: `LLM responded ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
    };

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      return { success: false, error: "LLM returned empty response" };
    }

    return { success: true, rawContent };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "LLM request timed out" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `LLM request failed: ${msg}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Fallback ──

/**
 * When the LLM is unavailable or returns no candidates, generate a simple
 * fallback candidate from the highest-tenure author's draft content.
 */
function generateFallbackCandidate(
  draftThread: { username: string; content: string }[],
  impulse: { title: string }
): string | null {
  if (draftThread.length === 0) {
    return `Proposal: ${impulse.title}`;
  }

  // Use the last draft as the most refined version
  const last = draftThread[draftThread.length - 1];
  return `Summary based on discussion: ${last.content}`;
}
