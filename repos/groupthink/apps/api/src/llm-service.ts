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

interface LLMCallResult {
  success: boolean;
  rawContent?: string;
  error?: string;
  latencyMs: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

// ── In-memory LLM metrics — exported for OTEL / monitoring endpoint ──

export interface LLMMetricsSnapshot {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  fallbackCount: number;
}

interface LLMMetricsState {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  fallbackCount: number;
}

const llmMetrics: LLMMetricsState = {
  totalCalls: 0,
  successCount: 0,
  failureCount: 0,
  totalLatencyMs: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  fallbackCount: 0,
};

function recordLLMCall(result: LLMCallResult): void {
  llmMetrics.totalCalls++;
  if (result.success) {
    llmMetrics.successCount++;
    llmMetrics.totalPromptTokens += result.promptTokens ?? 0;
    llmMetrics.totalCompletionTokens += result.completionTokens ?? 0;
  } else {
    llmMetrics.failureCount++;
  }
  llmMetrics.totalLatencyMs += result.latencyMs;
}

function recordFallback(): void {
  llmMetrics.fallbackCount++;
}

/** Return a snapshot of LLM metrics for health / monitoring endpoints. */
export function getLLMMetrics(): LLMMetricsSnapshot {
  return {
    totalCalls: llmMetrics.totalCalls,
    successCount: llmMetrics.successCount,
    failureCount: llmMetrics.failureCount,
    totalLatencyMs: llmMetrics.totalLatencyMs,
    avgLatencyMs:
      llmMetrics.totalCalls > 0
        ? Math.round(llmMetrics.totalLatencyMs / llmMetrics.totalCalls)
        : 0,
    totalPromptTokens: llmMetrics.totalPromptTokens,
    totalCompletionTokens: llmMetrics.totalCompletionTokens,
    fallbackCount: llmMetrics.fallbackCount,
  };
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
    const llmResult = await callLLM(systemPrompt, userPrompt);

    // Record metrics for monitoring
    recordLLMCall(llmResult);

    if (!llmResult.success) {
      log.error(`LLM summarization failed for ${impulseId.slice(0, 8)}`, {
        impulseId: impulseId.slice(0, 8),
        error: llmResult.error,
        latencyMs: llmResult.latencyMs,
      });

      // Fallback: try to generate a simple candidate
      const fallback = generateFallbackCandidate(draftThread, impulse);
      if (fallback) {
        recordFallback();
        await db.insert(schema.summaryCandidates).values({
          impulseId,
          content: fallback,
        });
        log.info(
          `impulse ${impulseId.slice(0, 8)}: LLM call failed, inserted fallback candidate`,
          { impulseId: impulseId.slice(0, 8), fallback: true }
        );
        return { success: true, candidates: [fallback] };
      }

      return {
        success: false,
        candidates: [],
        error: llmResult.error ?? "LLM summarization failed with no fallback",
      };
    }

    // 6. Parse and store candidates
    const candidates = parseLLMResponse(llmResult.rawContent ?? "");

    if (candidates.length === 0) {
      // Fallback: generate a simple candidate based on the top draft
      recordFallback();
      const fallback = generateFallbackCandidate(draftThread, impulse);
      if (fallback) {
        await db.insert(schema.summaryCandidates).values({
          impulseId,
          content: fallback,
        });
        log.info(
          `impulse ${impulseId.slice(0, 8)}: LLM returned 0 candidates, inserted fallback`,
          {
            impulseId: impulseId.slice(0, 8),
            fallback: true,
            llmLatencyMs: llmResult.latencyMs,
            llmModel: llmResult.model,
            promptTokens: llmResult.promptTokens,
            completionTokens: llmResult.completionTokens,
          }
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

    log.info(
      `impulse ${impulseId.slice(0, 8)}: generated ${candidates.length} candidates from LLM`,
      {
        impulseId: impulseId.slice(0, 8),
        candidateCount: candidates.length,
        bannedWordCount: bannedWords.length,
        llmLatencyMs: llmResult.latencyMs,
        llmModel: llmResult.model,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
      }
    );

    return { success: true, candidates };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`summarization failed for ${impulseId.slice(0, 8)}`, {
      error: msg,
      impulseId: impulseId.slice(0, 8),
    });

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
          recordFallback();
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
): Promise<LLMCallResult> {
  const start = performance.now();

  if (!LLM_API_KEY) {
    return { success: false, error: "LLM_API_KEY not configured", latencyMs: 0 };
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

    const latencyMs = Math.round(performance.now() - start);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.warn(`LLM returned HTTP ${response.status}`, {
        status: response.status,
        latencyMs,
        model: LLM_MODEL,
      });
      return {
        success: false,
        error: `LLM responded ${response.status}: ${body.slice(0, 200)}`,
        latencyMs,
        model: LLM_MODEL,
      };
    }

    const data = (await response.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      return {
        success: false,
        error: "LLM returned empty response",
        latencyMs,
        model: LLM_MODEL,
      };
    }

    const promptTokens = data.usage?.prompt_tokens;
    const completionTokens = data.usage?.completion_tokens;

    log.info("LLM call succeeded", {
      latencyMs,
      model: LLM_MODEL,
      promptTokens,
      completionTokens,
      finishReason: data.choices?.[0]?.finish_reason,
    });

    return {
      success: true,
      rawContent,
      latencyMs,
      model: LLM_MODEL,
      promptTokens,
      completionTokens,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);

    if (err instanceof Error && err.name === "AbortError") {
      log.warn("LLM request timed out", {
        latencyMs,
        timeoutMs: LLM_TIMEOUT_MS,
        model: LLM_MODEL,
      });
      return {
        success: false,
        error: "LLM request timed out",
        latencyMs,
        model: LLM_MODEL,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error("LLM request failed", {
      error: msg,
      latencyMs,
      model: LLM_MODEL,
    });
    return {
      success: false,
      error: `LLM request failed: ${msg}`,
      latencyMs,
      model: LLM_MODEL,
    };
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
