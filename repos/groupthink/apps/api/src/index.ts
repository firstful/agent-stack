import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "redis";
import { eq, desc, asc, and, sql as drizzleSql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as schema from "@groupthink/db";
import {
  CreateImpulseInput,
  CastVoteInput,
  SendDraftInput,
  CreateGroupInput,
  JoinGroupInput,
  tierForMemberCount,
  TIER_THRESHOLDS,
} from "@groupthink/shared";

const pg = postgres(process.env.DATABASE_URL!);
const db = drizzle(pg, { schema });
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const app = new Hono();
app.use("/*", cors());

// ── helpers ──
function generateCode(): string {
  return randomBytes(4).toString("hex");
}

async function availableInviteCodes(groupId: string): Promise<number> {
  const total = await db.$count(
    schema.inviteCodes,
    and(eq(schema.inviteCodes.groupId, groupId), eq(schema.inviteCodes.usedBy, null))
  );
  return total;
}

async function tenureWeight(userId: string, groupId: string): Promise<number> {
  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!membership) return 0;
  const days = Math.floor(
    (Date.now() - membership.joinedAt.getTime()) / 86400000
  );
  return Math.max(1, days);
}

async function updateGroupTier(groupId: string) {
  const count = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, groupId)
  );
  return tierForMemberCount(count);
}

// ── Feed ──
app.get("/api/feed", async (c) => {
  const minTier = c.req.query("minTier");
  const messages = await db.query.messages.findMany({
    where: (m, { and, eq, gte, ne }) => {
      const conditions = [eq(m.status, "active")];
      // Tier filter: only show messages where source group's tier is >= requested min
      if (minTier) {
        // Filter by group presence — messages always have a group
        conditions.push(ne(m.groupId, ""));
      }
      return and(...conditions);
    },
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 50,
    with: {
      group: true,
      targetGroup: true,
    },
  });

  // Post-query tier filter (groups tier is computed, not stored)
  if (minTier) {
    const tierOrder = ["fringe", "small", "medium", "large", "huge", "massive"];
    const minIdx = tierOrder.indexOf(minTier);
    if (minIdx >= 0) {
      const filtered = await Promise.all(
        messages.map(async (msg) => {
          const memberCount = await db.$count(
            schema.memberships,
            eq(schema.memberships.groupId, msg.groupId)
          );
          const { tierForMemberCount } = await import("@groupthink/shared");
          const groupTier = tierForMemberCount(memberCount);
          const tierIdx = tierOrder.indexOf(groupTier);
          return { msg, tierIdx };
        })
      );
      return c.json(
        filtered
          .filter((f) => f.tierIdx >= minIdx)
          .map((f) => f.msg)
      );
    }
  }

  return c.json(messages);
});

// ── Auth ──
app.post("/api/auth/register", async (c) => {
  const { provider, providerId, username } = await c.req.json();
  if (!provider || !providerId || !username) {
    return c.json({ error: "provider, providerId, and username required" }, 400);
  }

  const existing = await db.query.users.findFirst({
    where: (u, { or, and, eq }) =>
      or(
        and(eq(u.oauthProvider, provider), eq(u.oauthId, providerId)),
        eq(u.username, username)
      ),
  });
  if (existing) {
    return c.json({ error: "user already exists" }, 409);
  }

  const user = await db.insert(schema.users).values({
    oauthProvider: provider,
    oauthId: providerId,
    username,
  }).returning();

  return c.json(user[0], 201);
});

app.get("/api/auth/me", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return user ? c.json(user) : c.json({ error: "not found" }, 404);
});

// ── Groups ──
app.get("/api/groups", async (c) => {
  const groups = await db.query.groups.findMany({
    orderBy: (g, { asc }) => [asc(g.name)],
  });
  return c.json(groups);
});

app.post("/api/groups", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const body = await c.req.json();
  const input = CreateGroupInput.parse(body);

  const group = await db.insert(schema.groups).values({
    name: input.name,
    bio: input.bio,
    energy: input.energy,
    timezone: input.timezone || null,
  }).returning();

  const created = group[0];

  await db.insert(schema.memberships).values({
    userId,
    groupId: created.id,
    isVouched: true,
  });

  const codes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    await db.insert(schema.inviteCodes).values({
      groupId: created.id,
      code,
      createdBy: userId,
    });
    codes.push(code);
  }

  return c.json({ ...created, inviteCodes: codes }, 201);
});

app.get("/api/groups/:id", async (c) => {
  const group = await db.query.groups.findFirst({
    where: (g, { eq }) => eq(g.id, c.req.param("id")),
    with: { members: true },
  });
  if (!group) return c.json({ error: "not found" }, 404);

  const memberCount = group.members.length;
  const tier = await updateGroupTier(group.id);

  return c.json({ ...group, tier, memberCount });
});

app.get("/api/groups/:id/members", async (c) => {
  const members = await db.query.memberships.findMany({
    where: (m, { eq }) => eq(m.groupId, c.req.param("id")),
    with: { user: true },
    orderBy: (m, { asc }) => [asc(m.joinedAt)],
  });
  return c.json(members);
});

// ── Update Group Settings (bio, energy, timezone) ──
app.patch("/api/groups/:id/settings", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  const group = await db.query.groups.findFirst({
    where: (g, { eq }) => eq(g.id, groupId),
  });
  if (!group) return c.json({ error: "not found" }, 404);

  const { bio, energy, timezone, minInteractionTier } = await c.req.json();

  // Energy change requires 72-hour cooldown
  if (energy && energy !== group.energy) {
    const hoursSinceLastChange =
      (Date.now() - new Date(group.lastEnergyChangeAt).getTime()) / 3600000;
    if (hoursSinceLastChange < 72) {
      const hoursRemaining = Math.ceil(72 - hoursSinceLastChange);
      return c.json({
        error: `energy cooldown active — change available in ${hoursRemaining} hours`,
      }, 400);
    }
  }

  const updateData: Record<string, any> = {};
  if (bio !== undefined) updateData.bio = bio;
  if (energy !== undefined && energy !== group.energy) {
    updateData.energy = energy;
    updateData.lastEnergyChangeAt = new Date();
  }
  if (timezone !== undefined) updateData.timezone = timezone;
  if (minInteractionTier !== undefined) {
    // Validate: cannot exclude own tier
    const memberCount = await db.$count(
      schema.memberships,
      eq(schema.memberships.groupId, groupId)
    );
    const { tierForMemberCount } = await import("@groupthink/shared");
    const ownTier = tierForMemberCount(memberCount);
    const tierOrder = ["fringe", "small", "medium", "large", "huge", "massive"];
    const ownIdx = tierOrder.indexOf(ownTier);
    const setIdx = tierOrder.indexOf(minInteractionTier);
    if (setIdx > ownIdx) {
      return c.json({ error: `cannot set minimum tier higher than your own tier (${ownTier})` }, 400);
    }
    updateData.minInteractionTier = minInteractionTier;
  }

  if (Object.keys(updateData).length === 0) {
    return c.json({ error: "no changes provided" }, 400);
  }

  await db.update(schema.groups)
    .set(updateData)
    .where(eq(schema.groups.id, groupId));

  const updated = await db.query.groups.findFirst({
    where: (g, { eq }) => eq(g.id, groupId),
  });
  return c.json(updated);
});

// ── Block / Unblock Groups ──
app.post("/api/groups/:id/block", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetGroupId } = await c.req.json();
  if (!targetGroupId) return c.json({ error: "targetGroupId required" }, 400);

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);
  if (targetGroupId === groupId) return c.json({ error: "cannot block yourself" }, 400);

  const existing = await db.query.groupBlocks.findFirst({
    where: (b, { and, eq }) =>
      and(eq(b.blockerGroupId, groupId), eq(b.blockedGroupId, targetGroupId)),
  });
  if (existing) return c.json({ error: "already blocked" }, 400);

  await db.insert(schema.groupBlocks).values({
    blockerGroupId: groupId,
    blockedGroupId: targetGroupId,
  });

  return c.json({ ok: true }, 201);
});

app.post("/api/groups/:id/unblock", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetGroupId } = await c.req.json();
  if (!targetGroupId) return c.json({ error: "targetGroupId required" }, 400);

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);

  const block = await db.query.groupBlocks.findFirst({
    where: (b, { and, eq }) =>
      and(eq(b.blockerGroupId, groupId), eq(b.blockedGroupId, targetGroupId)),
  });
  if (!block) return c.json({ error: "not blocked" }, 404);

  await db.delete(schema.groupBlocks).where(eq(schema.groupBlocks.id, block.id));
  return c.json({ ok: true });
});

app.get("/api/groups/:id/blocks", async (c) => {
  const groupId = c.req.param("id");
  const blocks = await db.query.groupBlocks.findMany({
    where: (b, { eq }) => eq(b.blockerGroupId, groupId),
    with: { blockedGroup: true },
  });
  return c.json(blocks);
});

app.get("/api/groups/:id/invite-codes", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);

  const codes = await db.query.inviteCodes.findMany({
    where: (ic, { and, eq, isNull }) =>
      and(eq(ic.groupId, groupId), isNull(ic.usedBy)),
    orderBy: (ic, { desc }) => [desc(ic.createdAt)],
  });
  return c.json(codes);
});

app.post("/api/groups/:id/invite-codes", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);

  const existing = await availableInviteCodes(groupId);
  if (existing >= 5) {
    return c.json({ error: "maximum 5 unused invite codes allowed" }, 400);
  }

  const code = generateCode();
  await db.insert(schema.inviteCodes).values({
    groupId,
    code,
    createdBy: userId,
  });

  const codes = await db.query.inviteCodes.findMany({
    where: (ic, { and, eq, isNull }) =>
      and(eq(ic.groupId, groupId), isNull(ic.usedBy)),
  });
  return c.json(codes, 201);
});

// ── Join via invite code ──
app.post("/api/join", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const body = await c.req.json();
  const input = JoinGroupInput.parse(body);

  const invite = await db.query.inviteCodes.findFirst({
    where: (ic, { eq }) => eq(ic.code, input.code),
  });
  if (!invite) return c.json({ error: "invalid invite code" }, 404);

  if (invite.usedBy) return c.json({ error: "invite code already used" }, 400);

  const existing = await db.query.memberships.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.userId, userId), eq(m.groupId, invite.groupId)),
  });
  if (existing) return c.json({ error: "already a member" }, 400);

  await db.insert(schema.memberships).values({
    userId,
    groupId: invite.groupId,
  });

  await db.update(schema.inviteCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(eq(schema.inviteCodes.id, invite.id));

  return c.json({ ok: true, groupId: invite.groupId }, 200);
});

// ── Leave Group ──
app.post("/api/groups/:id/leave", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 404);

  // Cannot leave if you are the only member (would orphan the group)
  const memberCount = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, groupId)
  );
  if (memberCount <= 1) {
    return c.json({ error: "cannot leave: you are the only member" }, 400);
  }

  await db.delete(schema.memberships)
    .where(eq(schema.memberships.id, membership.id));

  return c.json({ ok: true });
});

// ── Group Nicknames ──
app.get("/api/groups/:id/nicknames", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);

  const nicknames = await db.query.groupNicknames.findMany({
    where: (n, { eq }) => eq(n.sourceGroupId, groupId),
    with: { targetGroup: true },
  });
  return c.json(nicknames);
});

app.post("/api/groups/:id/nicknames", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetGroupId, nickname } = await c.req.json();
  if (!targetGroupId || !nickname) {
    return c.json({ error: "targetGroupId and nickname required" }, 400);
  }

  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!member) return c.json({ error: "not a member" }, 403);

  // Upsert: replace any existing nickname for this target
  const existing = await db.query.groupNicknames.findFirst({
    where: (n, { and, eq }) =>
      and(eq(n.sourceGroupId, groupId), eq(n.targetGroupId, targetGroupId)),
  });

  if (existing) {
    await db.update(schema.groupNicknames)
      .set({ nickname })
      .where(eq(schema.groupNicknames.id, existing.id));
  } else {
    await db.insert(schema.groupNicknames).values({
      sourceGroupId: groupId,
      targetGroupId,
      nickname,
    });
  }

  return c.json({ ok: true });
});

app.delete("/api/nicknames/:id", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const nicknameId = c.req.param("id");

  const nickname = await db.query.groupNicknames.findFirst({
    where: (n, { eq }) => eq(n.id, nicknameId),
  });
  if (!nickname) return c.json({ error: "not found" }, 404);

  // Verify membership in source group
  const member = await db.query.memberships.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.userId, userId), eq(m.groupId, nickname.sourceGroupId)),
  });
  if (!member) return c.json({ error: "not authorized" }, 403);

  await db.delete(schema.groupNicknames)
    .where(eq(schema.groupNicknames.id, nicknameId));

  return c.json({ ok: true });
});

// ── Impulses ──
app.post("/api/groups/:id/impulses", async (c) => {
  const body = await c.req.json();
  const input = CreateImpulseInput.parse(body);
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");

  const position = await db.$count(
    schema.impulses,
    and(
      eq(schema.impulses.groupId, groupId),
      eq(schema.impulses.status, "queued")
    )
  ) + 1;

  // Tier filter: if targeting another group, check minInteractionTier
  if (input.targetGroupId) {
    const targetGroup = await db.query.groups.findFirst({
      where: (g, { eq }) => eq(g.id, input.targetGroupId),
    });
    if (targetGroup?.minInteractionTier) {
      const sourceMemberCount = await db.$count(
        schema.memberships,
        eq(schema.memberships.groupId, groupId)
      );
      const { tierForMemberCount } = await import("@groupthink/shared");
      const sourceTier = tierForMemberCount(sourceMemberCount);
      const tierOrder = ["fringe", "small", "medium", "large", "huge", "massive"];
      const sourceIdx = tierOrder.indexOf(sourceTier);
      const minIdx = tierOrder.indexOf(targetGroup.minInteractionTier as string);
      if (sourceIdx < minIdx) {
        return c.json({
          error: `target group requires minimum tier ${targetGroup.minInteractionTier}, your group is ${sourceTier}`,
        }, 403);
      }
    }
  }

  const impulse = await db.insert(schema.impulses).values({
    groupId,
    targetGroupId: input.targetGroupId || null,
    targetPostId: input.targetPostId || null,
    title: input.title,
    description: input.description,
    createdBy: userId,
    status: "queued",
    queuePosition: position,
  }).returning();

  return c.json(impulse[0], 201);
});

app.get("/api/groups/:id/impulses", async (c) => {
  const status = c.req.query("status");
  const where = [eq(schema.impulses.groupId, c.req.param("id"))];
  if (status) where.push(eq(schema.impulses.status, status));

  const impulses = await db.query.impulses.findMany({
    where: and(...where),
    orderBy: [asc(schema.impulses.queuePosition), desc(schema.impulses.createdAt)],
  });
  return c.json(impulses);
});

app.get("/api/impulses/:id", async (c) => {
  const impulse = await db.query.impulses.findFirst({
    where: (i, { eq }) => eq(i.id, c.req.param("id")),
    with: { votes: true, drafts: true, summaryCandidates: true },
  });
  return impulse ? c.json(impulse) : c.json({ error: "not found" }, 404);
});

// ── Voting ──
app.post("/api/impulses/:id/vote", async (c) => {
  const body = await c.req.json();
  const input = CastVoteInput.parse(body);
  const userId = c.req.header("x-user-id")!;

  const impulse = await db.query.impulses.findFirst({
    where: (i, { eq }) => eq(i.id, input.impulseId),
  });
  if (!impulse || impulse.status !== "voting") {
    return c.json({ error: "not in voting phase" }, 400);
  }

  const weight = await tenureWeight(userId, impulse.groupId);
  const existing = await db.query.votes.findFirst({
    where: (v, { and, eq }) =>
      and(eq(v.impulseId, input.impulseId), eq(v.userId, userId)),
  });

  if (existing) {
    await db.update(schema.votes)
      .set({ vote: input.vote, weight, castAt: new Date() })
      .where(eq(schema.votes.id, existing.id));
  } else {
    await db.insert(schema.votes).values({
      impulseId: input.impulseId,
      userId,
      vote: input.vote,
      weight,
    });
  }

  const voteCount = await db.$count(
    schema.votes,
    eq(schema.votes.impulseId, input.impulseId)
  );

  await redis.publish(
    `impulse:${input.impulseId}:votes`,
    JSON.stringify({ count: voteCount })
  );

  return c.json({ ok: true, voteCount });
});

// ── Vote Tally (weighted by tenure cohort) ──
app.get("/api/impulses/:id/tally", async (c) => {
  const impulseId = c.req.param("id");
  const impulse = await db.query.impulses.findFirst({
    where: (i, { eq }) => eq(i.id, impulseId),
  });
  if (!impulse) return c.json({ error: "not found" }, 404);

  const votes = await db.query.votes.findMany({
    where: (v, { eq }) => eq(v.impulseId, impulseId),
    with: { user: true },
  });

  // Tenure cohorts: <30d, 30-89d, 90-364d, 365d+
  const cohorts = [
    { range: "< 30 days", minDays: 0, maxDays: 29, yesWeight: 0, noWeight: 0, voterCount: 0 },
    { range: "30–89 days", minDays: 30, maxDays: 89, yesWeight: 0, noWeight: 0, voterCount: 0 },
    { range: "90–364 days", minDays: 90, maxDays: 364, yesWeight: 0, noWeight: 0, voterCount: 0 },
    { range: "365+ days", minDays: 365, maxDays: Infinity, yesWeight: 0, noWeight: 0, voterCount: 0 },
  ];

  let totalYesWeight = 0;
  let totalNoWeight = 0;
  let totalVoters = 0;

  for (const v of votes) {
    const daysSinceJoining = v.user
      ? Math.floor((Date.now() - new Date(v.user.createdAt).getTime()) / 86400000)
      : 0;
    const cohort = cohorts.find(
      (c) => daysSinceJoining >= c.minDays && daysSinceJoining <= c.maxDays
    );
    if (!cohort) continue;

    if (v.vote === "yes") cohort.yesWeight += v.weight;
    else if (v.vote === "no") cohort.noWeight += v.weight;
    cohort.voterCount++;

    if (v.vote === "yes") totalYesWeight += v.weight;
    else if (v.vote === "no") totalNoWeight += v.weight;
    totalVoters++;
  }

  return c.json({
    cohorts,
    totals: { yesWeight: totalYesWeight, noWeight: totalNoWeight, totalVoters },
  });
});

// ── Composer / Drafts ──
app.post("/api/impulses/:id/draft", async (c) => {
  const body = await c.req.json();
  const input = SendDraftInput.parse(body);
  const userId = c.req.header("x-user-id")!;

  const impulse = await db.query.impulses.findFirst({
    where: (i, { eq }) => eq(i.id, input.impulseId),
  });
  if (!impulse || impulse.status !== "composing") {
    return c.json({ error: "not in composing phase" }, 400);
  }

  const draft = await db.insert(schema.drafts).values({
    impulseId: input.impulseId,
    userId,
    content: input.content,
    parentDraftId: body.parentDraftId || null,
  }).returning();

  return c.json(draft[0], 201);
});

app.get("/api/impulses/:id/drafts", async (c) => {
  const drafts = await db.query.drafts.findMany({
    where: (d, { eq }) => eq(d.impulseId, c.req.param("id")),
    orderBy: (d, { asc }) => [asc(d.createdAt)],
    with: { user: true },
  });
  return c.json(drafts);
});

// ── Summary Candidates ──
app.get("/api/impulses/:id/summaries", async (c) => {
  const summaries = await db.query.summaryCandidates.findMany({
    where: (s, { eq }) => eq(s.impulseId, c.req.param("id")),
  });
  return c.json(summaries);
});

// ── Messages (broadcast) ──
app.get("/api/messages/:id", async (c) => {
  const message = await db.query.messages.findFirst({
    where: (m, { eq }) => eq(m.id, c.req.param("id")),
    with: { group: true, targetGroup: true, retweets: true },
  });
  return message ? c.json(message) : c.json({ error: "not found" }, 404);
});

app.post("/api/messages/:id/revoke", async (c) => {
  const message = await db.query.messages.findFirst({
    where: (m, { eq }) => eq(m.id, c.req.param("id")),
  });
  if (!message) return c.json({ error: "not found" }, 404);

  const hoursSinceCreated =
    (Date.now() - message.createdAt.getTime()) / 3600000;
  if (hoursSinceCreated > 24) {
    return c.json({ error: "revocation window expired (24h)" }, 400);
  }

  await db.update(schema.messages)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(schema.messages.id, c.req.param("id")));

  return c.json({ ok: true });
});

// ── Retweet / Endorsement (with global rate limit) ──
const ENDORSE_RATE_LIMIT = 10;
const ENDORSE_WINDOW_MS = 24 * 60 * 60 * 1000;

app.post("/api/messages/:id/endorse", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const messageId = c.req.param("id");

  const message = await db.query.messages.findFirst({
    where: (m, { and, eq }) => and(eq(m.id, messageId), eq(m.status, "active")),
  });
  if (!message) return c.json({ error: "message not found or revoked" }, 404);

  const existing = await db.query.retweets.findFirst({
    where: (r, { and, eq }) =>
      and(eq(r.messageId, messageId), eq(r.groupId, message.groupId)),
  });
  if (existing) return c.json({ error: "already endorsed" }, 400);

  const rateKey = `rate:endorse:${new Date().toISOString().slice(0, 10)}`;
  const currentRate = parseInt((await redis.get(rateKey)) || "0", 10);
  if (currentRate >= ENDORSE_RATE_LIMIT) {
    return c.json({ error: "global endorsement rate limit reached (max 10/day)" }, 429);
  }

  await db.insert(schema.retweets).values({
    messageId,
    groupId: message.groupId,
  });

  await redis.incr(rateKey);
  await redis.expire(rateKey, Math.ceil(ENDORSE_WINDOW_MS / 1000));

  const endorsements = await db.$count(
    schema.retweets,
    eq(schema.retweets.messageId, messageId)
  );

  return c.json({ ok: true, endorsements }, 201);
});

app.delete("/api/messages/:id/endorse", async (c) => {
  const messageId = c.req.param("id");

  const message = await db.query.messages.findFirst({
    where: (m, { eq }) => eq(m.id, messageId),
  });
  if (!message) return c.json({ error: "not found" }, 404);

  // Find retweet by the message's group
  const retweet = await db.query.retweets.findFirst({
    where: (r, { and, eq }) =>
      and(eq(r.messageId, messageId), eq(r.groupId, message.groupId)),
  });
  if (!retweet) return c.json({ error: "not endorsed" }, 404);

  await db.delete(schema.retweets)
    .where(eq(schema.retweets.id, retweet.id));

  const endorsements = await db.$count(
    schema.retweets,
    eq(schema.retweets.messageId, messageId)
  );

  return c.json({ ok: true, endorsements });
});

// ── Search ──
app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.toLowerCase();
  if (!q) return c.json({ groups: [], messages: [] });

  const groups = await db.query.groups.findMany({
    where: (g, { or, ilike }) =>
      or(ilike(g.name, `%${q}%`), ilike(g.bio, `%${q}%`)),
    limit: 20,
  });

  const messages = await db.query.messages.findMany({
    where: (m, { and, eq, ilike }) =>
      and(eq(m.status, "active"), ilike(m.content, `%${q}%`)),
    limit: 20,
  });

  return c.json({ groups, messages });
});

// ── Health ──
app.get("/health", (c) => c.json({ ok: true }));

// ── Impulse Lifecycle Engine ──
import { startLifecycleEngine } from "./lifecycle";
startLifecycleEngine(pg, redis as any);

const port = Number(process.env.APP_PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api running on :${port}`);
