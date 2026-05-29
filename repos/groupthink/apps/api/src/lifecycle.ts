import { eq, and, desc, asc, sql, lt, inArray, or, not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import type { RedisClientType } from "redis";
import * as schema from "@groupthink/db";
import {
  canTransition,
  adaptiveRemaining,
  MAX_VOTING_WINDOW,
  MAX_COMPOSING_WINDOW,
} from "@groupthink/shared";

const POLL_INTERVAL = 8_000; // 8 seconds
const MAX_ACTIVE_PER_GROUP = 1;
const VOTE_ADVANCE_RATIO = 0.5;
const VOTE_QUORUM_RATIO = 0.3;

function log(msg: string) {
  console.log(`[lifecycle] ${msg}`);
}
function error(msg: string, err?: unknown) {
  console.error(`[lifecycle] ${msg}`, err ?? "");
}

export function startLifecycleEngine(client: postgres.Sql, redis: RedisClientType) {
  const db = drizzle(client, { schema });
  log(`engine started (poll every ${POLL_INTERVAL}ms)`);

  const tick = async () => {
    try {
      await advanceQueuedToVoting(db);
      await advanceVotingToNext(db, redis);
      await expireStaleComposing(db);
      await advanceSummarizingToApproval(db);
      await resolveApprovalPhase(db, redis);
      await expireOrphanedImpulses(db);
    } catch (err) {
      error("tick failed", err);
    }
  };

  setInterval(tick, POLL_INTERVAL);
  tick();
}

// ── Phase 1: queued → voting ──

async function advanceQueuedToVoting(db: ReturnType<typeof drizzle<typeof schema>>) {
  const groupsWithQueued = await db
    .selectDistinct({ groupId: schema.impulses.groupId })
    .from(schema.impulses)
    .where(eq(schema.impulses.status, "queued"));

  if (groupsWithQueued.length === 0) return;

  for (const { groupId } of groupsWithQueued) {
    try {
      // Check group already has active impulses in flight
      const activeCount = await db.$count(
        schema.impulses,
        and(
          eq(schema.impulses.groupId, groupId),
          inArray(schema.impulses.status, [
            "voting",
            "composing",
            "summarizing",
            "approval",
          ])
        )
      );

      if (activeCount >= MAX_ACTIVE_PER_GROUP) continue;

      // Find queued impulses for this group
      const queued = await db
        .select()
        .from(schema.impulses)
        .where(
          and(
            eq(schema.impulses.status, "queued"),
            eq(schema.impulses.groupId, groupId)
          )
        )
        .orderBy(asc(schema.impulses.queuePosition), asc(schema.impulses.createdAt));

      if (queued.length === 0) continue;

      // Get creator tenure for each queued impulse
      const creatorIds = [...new Set(queued.map((q) => q.createdBy))];
      const creators = await db
        .select()
        .from(schema.users)
        .where(inArray(schema.users.id, creatorIds));

      const creatorMap = new Map(creators.map((u) => [u.id, u]));

      // Score each impulse by creator tenure
      const scored = queued.map((imp) => {
        const user = creatorMap.get(imp.createdBy);
        const days = user
          ? Math.max(1, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
          : 1;
        return { impulse: imp, tenureDays: days };
      });

      scored.sort((a, b) => {
        const td = b.tenureDays - a.tenureDays;
        if (td !== 0) return td;
        return new Date(a.impulse.createdAt).getTime() - new Date(b.impulse.createdAt).getTime();
      });

      const winner = scored[0];
      if (!winner) continue;

      const votingEndsAt = new Date(Date.now() + MAX_VOTING_WINDOW);
      await db
        .update(schema.impulses)
        .set({ status: "voting", votingEndsAt })
        .where(eq(schema.impulses.id, winner.impulse.id));

      log(
        `queued→voting: impulse ${winner.impulse.id.slice(0, 8)} in group ${groupId.slice(0, 8)} ` +
        `(tenure ${winner.tenureDays}d)`
      );

      // Recalc queue positions for remaining
      await recalculateQueue(db, groupId, winner.impulse.id);
    } catch (err) {
      error(`advanceQueuedToVoting group ${groupId.slice(0, 8)}`, err);
    }
  }
}

async function recalculateQueue(db: ReturnType<typeof drizzle<typeof schema>>, groupId: string, skipId: string) {
  const remaining = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.groupId, groupId),
        eq(schema.impulses.status, "queued"),
        not(eq(schema.impulses.id, skipId))
      )
    )
    .orderBy(asc(schema.impulses.queuePosition), asc(schema.impulses.createdAt));

  if (remaining.length === 0) return;

  const creatorIds = [...new Set(remaining.map((q) => q.createdBy))];
  const creators = await db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.id, creatorIds));
  const creatorMap = new Map(creators.map((u) => [u.id, u]));

  const scored = remaining.map((imp) => ({
    id: imp.id,
    days: (() => {
      const user = creatorMap.get(imp.createdBy);
      return user
        ? Math.max(1, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
        : 1;
    })(),
    createdAt: new Date(imp.createdAt).getTime(),
  }));

  scored.sort((a, b) => {
    const td = b.days - a.days;
    if (td !== 0) return td;
    return a.createdAt - b.createdAt;
  });

  for (let i = 0; i < scored.length; i++) {
    const pos = i + 1;
    const current = remaining.find((r) => r.id === scored[i].id);
    if (current && current.queuePosition !== pos) {
      await db
        .update(schema.impulses)
        .set({ queuePosition: pos })
        .where(eq(schema.impulses.id, scored[i].id));
    }
  }
}

// ── Phase 2: voting → composing / expired ──

async function advanceVotingToNext(db: ReturnType<typeof drizzle<typeof schema>>, redis: RedisClientType) {
  const voting = await db
    .select()
    .from(schema.impulses)
    .where(eq(schema.impulses.status, "voting"));

  for (const impulse of voting) {
    try {
      const now = Date.now();
      const createdAt = new Date(impulse.createdAt).getTime();
      const elapsed = now - createdAt;
      const votingEndsAt = impulse.votingEndsAt
        ? new Date(impulse.votingEndsAt).getTime()
        : now + MAX_VOTING_WINDOW;

      const windowExpired = now >= votingEndsAt;
      if (!windowExpired) {
        // Also check adaptive collapse
        const memberCount = await db.$count(
          schema.memberships,
          eq(schema.memberships.groupId, impulse.groupId)
        );

        const votes = await db
          .select()
          .from(schema.votes)
          .where(eq(schema.votes.impulseId, impulse.id));

        const remaining = adaptiveRemaining({
          totalMembers: memberCount,
          votesCast: votes.length,
          yesVotes: votes.filter((v) => v.vote === "yes").length,
          noVotes: votes.filter((v) => v.vote === "no").length,
          elapsedMs: elapsed,
        });

        if (remaining > 0) continue; // still open
      }

      // Window closed — tally votes
      const votes = await db
        .select()
        .from(schema.votes)
        .where(eq(schema.votes.impulseId, impulse.id));

      let yesWeight = 0;
      let noWeight = 0;
      for (const v of votes) {
        if (v.vote === "yes") yesWeight += v.weight;
        else if (v.vote === "no") noWeight += v.weight;
      }

      const totalWeight = yesWeight + noWeight;
      const yesRatio = totalWeight > 0 ? yesWeight / totalWeight : 0;
      const memberCount = await db.$count(
        schema.memberships,
        eq(schema.memberships.groupId, impulse.groupId)
      );
      const meetsQuorum = votes.length >= Math.ceil(memberCount * VOTE_QUORUM_RATIO);

      if (meetsQuorum && yesRatio >= VOTE_ADVANCE_RATIO) {
        await db
          .update(schema.impulses)
          .set({ status: "composing" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`voting→composing: ${impulse.id.slice(0, 8)} (yes=${yesWeight}, no=${noWeight})`);
        await redis.publish(
          `impulse:${impulse.id}:transition`,
          JSON.stringify({ from: "voting", to: "composing" })
        );
      } else {
        await db
          .update(schema.impulses)
          .set({ status: "expired" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`voting→expired: ${impulse.id.slice(0, 8)} (quorum=${meetsQuorum}, yesRatio=${yesRatio.toFixed(2)})`);
      }
    } catch (err) {
      error(`advanceVotingToNext ${impulse.id.slice(0, 8)}`, err);
    }
  }
}

// ── Phase 3: composing → summarizing / expired ──

async function expireStaleComposing(db: ReturnType<typeof drizzle<typeof schema>>) {
  const composing = await db
    .select()
    .from(schema.impulses)
    .where(eq(schema.impulses.status, "composing"));

  for (const impulse of composing) {
    try {
      const elapsed = Date.now() - new Date(impulse.createdAt).getTime();
      const draftCount = await db.$count(
        schema.drafts,
        eq(schema.drafts.impulseId, impulse.id)
      );
      const extension = draftCount * MAX_COMPOSING_WINDOW * 0.2;
      const totalWindow = MAX_COMPOSING_WINDOW + extension;

      if (elapsed < totalWindow) continue;

      if (draftCount > 0) {
        await db
          .update(schema.impulses)
          .set({ status: "summarizing" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`composing→summarizing: ${impulse.id.slice(0, 8)} (${draftCount} drafts)`);
      } else {
        await db
          .update(schema.impulses)
          .set({ status: "expired" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`composing→expired: ${impulse.id.slice(0, 8)} (no drafts)`);
      }
    } catch (err) {
      error(`expireStaleComposing ${impulse.id.slice(0, 8)}`, err);
    }
  }
}

// ── Phase 4: summarizing → approval ──

async function advanceSummarizingToApproval(db: ReturnType<typeof drizzle<typeof schema>>) {
  const summarizing = await db
    .select()
    .from(schema.impulses)
    .where(eq(schema.impulses.status, "summarizing"));

  for (const impulse of summarizing) {
    try {
      const candidateCount = await db.$count(
        schema.summaryCandidates,
        eq(schema.summaryCandidates.impulseId, impulse.id)
      );
      if (candidateCount < 2) continue;

      await db
        .update(schema.impulses)
        .set({ status: "approval" })
        .where(eq(schema.impulses.id, impulse.id));

      log(`summarizing→approval: ${impulse.id.slice(0, 8)} (${candidateCount} candidates)`);
    } catch (err) {
      error(`advanceSummarizingToApproval ${impulse.id.slice(0, 8)}`, err);
    }
  }
}

// ── Phase 5: approval → broadcast / discarded ──

async function resolveApprovalPhase(db: ReturnType<typeof drizzle<typeof schema>>, redis: RedisClientType) {
  const approval = await db
    .select()
    .from(schema.impulses)
    .where(eq(schema.impulses.status, "approval"));

  for (const impulse of approval) {
    try {
      const elapsed = Date.now() - new Date(impulse.createdAt).getTime();
      const APPROVAL_MIN_WINDOW = 5 * 60 * 1000; // 5 min minimum
      const APPROVAL_MAX_WINDOW = 30 * 60 * 1000; // 30 min max

      if (elapsed < APPROVAL_MIN_WINDOW) continue;

      const votes = await db
        .select()
        .from(schema.votes)
        .where(eq(schema.votes.impulseId, impulse.id));

      const yesCount = votes.filter((v) => v.vote === "yes").length;
      const noCount = votes.filter((v) => v.vote === "no").length;
      const totalVoters = yesCount + noCount;
      const memberCount = await db.$count(
        schema.memberships,
        eq(schema.memberships.groupId, impulse.groupId)
      );

      const timeExpired = elapsed >= APPROVAL_MAX_WINDOW;
      const quorumMet = totalVoters >= Math.ceil(memberCount * 0.2);
      const majorityYes = totalVoters > 0 && yesCount > noCount;

      const shouldBroadcast =
        (quorumMet && majorityYes) || (timeExpired && majorityYes);

      if (shouldBroadcast) {
        // Pick the first summary candidate to broadcast
        const candidates = await db
          .select()
          .from(schema.summaryCandidates)
          .where(eq(schema.summaryCandidates.impulseId, impulse.id))
          .orderBy(asc(schema.summaryCandidates.createdAt))
          .limit(1);

        const winner = candidates[0];
        if (!winner) {
          await db
            .update(schema.impulses)
            .set({ status: "discarded" })
            .where(eq(schema.impulses.id, impulse.id));
          continue;
        }

        await db.insert(schema.messages).values({
          impulseId: impulse.id,
          groupId: impulse.groupId,
          targetGroupId: impulse.targetGroupId,
          targetPostId: impulse.targetPostId,
          content: winner.content,
          status: "active",
        });

        await db
          .update(schema.impulses)
          .set({ status: "broadcast" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`approval→broadcast: ${impulse.id.slice(0, 8)} from ${impulse.groupId.slice(0, 8)}`);

        await redis.publish(`impulse:${impulse.id}:transition`, JSON.stringify({ from: "approval", to: "broadcast" }));
        await redis.publish("feed:new", JSON.stringify({ impulseId: impulse.id }));
      } else if (timeExpired) {
        await db
          .update(schema.impulses)
          .set({ status: "discarded" })
          .where(eq(schema.impulses.id, impulse.id));

        log(`approval→discarded: ${impulse.id.slice(0, 8)} (no consensus)`);
      }
    } catch (err) {
      error(`resolveApprovalPhase ${impulse.id.slice(0, 8)}`, err);
    }
  }
}

// ── Cleanup: stale impulses ──

async function expireOrphanedImpulses(db: ReturnType<typeof drizzle<typeof schema>>) {
  const MAX_QUEUE_AGE = 7 * 24 * 60 * 60 * 1000;
  const staleQueued = await db
    .select()
    .from(schema.impulses)
    .where(
      and(
        eq(schema.impulses.status, "queued"),
        lt(schema.impulses.createdAt, new Date(Date.now() - MAX_QUEUE_AGE))
      )
    );

  for (const imp of staleQueued) {
    await db
      .update(schema.impulses)
      .set({ status: "expired" })
      .where(eq(schema.impulses.id, imp.id));
    log(`queued→expired (stale): ${imp.id.slice(0, 8)}`);
  }
}
