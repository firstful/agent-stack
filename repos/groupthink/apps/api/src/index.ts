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
    where: (m, { and, eq, ne }) =>
      and(
        eq(m.status, "active"),
        minTier ? ne(m.targetGroupId, null) : undefined
      ),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit: 50,
    with: {
      group: true,
      targetGroup: true,
    },
  });
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

const port = Number(process.env.APP_PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api running on :${port}`);
