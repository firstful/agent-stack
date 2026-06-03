import { eq, and, lt, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import type { RedisClientType } from "redis";
import * as schema from "@groupthink/db";
import { logger } from "./logger";
import { REPUTATION_HALF_LIFE_DAYS } from "@groupthink/shared";

const slog = logger.child({ component: "scheduled-jobs" });

function log(msg: string, meta?: Record<string, unknown>) {
  slog.info(msg, meta);
}

function error(msg: string, err?: unknown) {
  slog.error(msg, { err: err instanceof Error ? err.message : String(err ?? "") });
}

// ── 1. Reputation Decay (daily) ──────────────────────────────────────────────
//
// Every user's reputation decays by half every REPUTATION_HALF_LIFE_DAYS (60)
// days of inactivity.  The decay is applied to the current reputation value so
// a user who was previously active and had decayed partially will decay from
// whatever value they have right now.

const ONE_DAY_MS = 86_400_000;

export async function runReputationDecay(db: ReturnType<typeof drizzle<typeof schema>>) {
  const users = await db
    .select({ id: schema.users.id, lastActiveAt: schema.users.lastActiveAt, reputation: schema.users.reputation })
    .from(schema.users);

  let count = 0;
  for (const user of users) {
    const daysSince = (Date.now() - user.lastActiveAt.getTime()) / ONE_DAY_MS;
    if (daysSince <= 0) continue;

    const decay = Math.pow(0.5, daysSince / REPUTATION_HALF_LIFE_DAYS);
    const newRep = user.reputation * decay;

    // Only update if the change is meaningful (avoids noise on every tick)
    if (Math.abs(newRep - user.reputation) > 0.0001) {
      await db
        .update(schema.users)
        .set({ reputation: newRep })
        .where(eq(schema.users.id, user.id));
      count++;
    }
  }

  log(`reputation decay applied to ${count} users`);
}

// ── 2. Impulse Expiry (minute) ───────────────────────────────────────────────
//
// Safety net that catches stalled impulses the 8-second lifecycle engine may
// have missed.  Applies stricter deadlines than the primary engine so it only
// acts as a backstop.

const MAX_QUEUE_AGE = 7 * ONE_DAY_MS;         // 7 days
const MAX_VOTING_AGE = 6 * 60 * 60 * 1000;    // 6 hours (primary: 4h adaptive)
const MAX_COMPOSING_AGE = 3 * 60 * 60 * 1000; // 3 hours (primary: 1h adaptive)
const MAX_SUMMARIZING_AGE = 2 * 60 * 60 * 1000; // 2 hours
const MAX_APPROVAL_AGE = 2 * 60 * 60 * 1000;  // 2 hours (primary: 30m)

export async function runImpulseExpiry(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date();
  let total = 0;

  // Queued — older than 7 days
  const staleQueued = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "queued"),
        lt(schema.impulses.createdAt, new Date(now.getTime() - MAX_QUEUE_AGE))
      )
    );

  for (const imp of staleQueued) {
    await db
      .update(schema.impulses)
      .set({ status: "expired" })
      .where(eq(schema.impulses.id, imp.id));
    total++;
  }

  // Voting — votingEndsAt has passed (safety net, primary engine should catch these)
  const staleVoting = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "voting"),
        lt(schema.impulses.createdAt, new Date(now.getTime() - MAX_VOTING_AGE))
      )
    );

  for (const imp of staleVoting) {
    await db
      .update(schema.impulses)
      .set({ status: "expired" })
      .where(eq(schema.impulses.id, imp.id));
    total++;
  }

  // Composing — stalled without drafts beyond max window
  const staleComposing = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "composing"),
        lt(schema.impulses.createdAt, new Date(now.getTime() - MAX_COMPOSING_AGE))
      )
    );

  for (const imp of staleComposing) {
    const draftCount = await db.$count(
      schema.drafts,
      eq(schema.drafts.impulseId, imp.id)
    );

    await db
      .update(schema.impulses)
      .set({ status: draftCount > 0 ? "summarizing" : "expired" })
      .where(eq(schema.impulses.id, imp.id));
    total++;
  }

  // Summarizing — stuck with no candidates
  const staleSummarizing = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "summarizing"),
        lt(schema.impulses.createdAt, new Date(now.getTime() - MAX_SUMMARIZING_AGE))
      )
    );

  for (const imp of staleSummarizing) {
    const candidateCount = await db.$count(
      schema.summaryCandidates,
      eq(schema.summaryCandidates.impulseId, imp.id)
    );

    if (candidateCount < 2) {
      await db
        .update(schema.impulses)
        .set({ status: "expired" })
        .where(eq(schema.impulses.id, imp.id));
      total++;
    }
  }

  // Approval — stuck without resolution
  const staleApproval = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "approval"),
        lt(schema.impulses.createdAt, new Date(now.getTime() - MAX_APPROVAL_AGE))
      )
    );

  for (const imp of staleApproval) {
    await db
      .update(schema.impulses)
      .set({ status: "discarded" })
      .where(eq(schema.impulses.id, imp.id));
    total++;
  }

  if (total > 0) {
    log(`impulse expiry: ${total} impulses expired`);
  }
}

// ── 3. Sabbatical Expiry (hourly) ────────────────────────────────────────────
//
// Groups whose sabbatical period has passed have their sabbaticalUntil cleared,
// re-enabling normal activity.

export async function runSabbaticalExpiry(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date();
  const expired = await db
    .select({ id: schema.groups.id, name: schema.groups.name, sabbaticalUntil: schema.groups.sabbaticalUntil })
    .from(schema.groups)
    .where(
      and(
        sql`${schema.groups.sabbaticalUntil} IS NOT NULL`,
        lt(schema.groups.sabbaticalUntil, now)
      )
    );

  for (const group of expired) {
    await db
      .update(schema.groups)
      .set({ sabbaticalUntil: null })
      .where(eq(schema.groups.id, group.id));
  }

  if (expired.length > 0) {
    log(`sabbatical expired for ${expired.length} groups`);
  }
}

// ── 4. Invite Code Cleanup (daily) ───────────────────────────────────────────
//
// Remove unused invite codes whose expiration date has passed.

export async function runInviteCodeCleanup(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date();
  const result = await db
    .delete(schema.inviteCodes)
    .where(
      and(
        isNull(schema.inviteCodes.usedBy),
        sql`${schema.inviteCodes.expiresAt} IS NOT NULL`,
        lt(schema.inviteCodes.expiresAt, now)
      )
    )
    .returning({ id: schema.inviteCodes.id });

  if (result.length > 0) {
    log(`invite code cleanup: ${result.length} expired codes deleted`);
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────
//
// Starts the four scheduled jobs at their prescribed intervals.

export function startScheduledJobs(client: postgres.Sql, redis: RedisClientType) {
  const db = drizzle(client, { schema });
  log("scheduler started");

  // ── Reputation decay — daily ──
  const DAILY_MS = ONE_DAY_MS;
  setInterval(async () => {
    try {
      await runReputationDecay(db);
    } catch (err) {
      error("reputation decay job failed", err);
    }
  }, DAILY_MS);

  // Run the first decay after a short delay so startup isn't slowed
  setTimeout(async () => {
    try {
      await runReputationDecay(db);
    } catch (err) {
      error("initial reputation decay failed", err);
    }
  }, 30_000);

  // ── Impulse expiry — every minute ──
  const MINUTE_MS = 60_000;
  setInterval(async () => {
    try {
      await runImpulseExpiry(db);
    } catch (err) {
      error("impulse expiry job failed", err);
    }
  }, MINUTE_MS);

  // ── Sabbatical expiry — hourly ──
  const HOUR_MS = 60 * MINUTE_MS;
  setInterval(async () => {
    try {
      await runSabbaticalExpiry(db);
    } catch (err) {
      error("sabbatical expiry job failed", err);
    }
  }, HOUR_MS);

  // Run the first sabbatical check after a minute
  setTimeout(async () => {
    try {
      await runSabbaticalExpiry(db);
    } catch (err) {
      error("initial sabbatical expiry failed", err);
    }
  }, 60_000);

  // ── Invite code cleanup — daily ──
  setInterval(async () => {
    try {
      await runInviteCodeCleanup(db);
    } catch (err) {
      error("invite code cleanup job failed", err);
    }
  }, DAILY_MS);

  // Run the first cleanup after 2 minutes
  setTimeout(async () => {
    try {
      await runInviteCodeCleanup(db);
    } catch (err) {
      error("initial invite code cleanup failed", err);
    }
  }, 120_000);
}
