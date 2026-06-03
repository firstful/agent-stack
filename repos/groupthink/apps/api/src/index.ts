import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "redis";
import { randomBytes } from "node:crypto";
import { eq, and, gt, or, isNull } from "drizzle-orm";
import * as schema from "@groupthink/db";
import { logger } from "./logger";
import { rateLimitMiddleware } from "./rate-limiter";
import { requestLoggingMiddleware } from "./request-logger";
import { initTelemetry } from "./telemetry";
import { authMiddleware } from "./auth-middleware";
import {
  signToken,
  verifyToken,
  getAuthorizeUrl,
  exchangeCode,
  getUserInfo,
  decodeAppleIdToken,
  verifyTurnstile,
  generatePlaceholderUsername,
  isValidUsername,
  type OAuthProvider,
} from "./auth";
import {
  CreateImpulseInput,
  CastVoteInput,
  SendDraftInput,
  CreateGroupInput,
  JoinGroupInput,
  SendDMInput,
  tierForMemberCount,
  TIER_THRESHOLDS,
  adaptiveRemaining,
  applyVoteSuppression,
  activityGateMultiplier,
  activityGateBreakdown,
  combinedVoteWeight,
  vouchMultiplier,
  sanitizeText,
  sanitizeRichText,
  sanitizeAndTruncate,
  MAX_LENGTHS,
  type EngagementEvent,
} from "@groupthink/shared";
import { auditLog, AuditActions } from "./audit-logger";

const pg = postgres(process.env.DATABASE_URL!);
const db = drizzle(pg, { schema });
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const app = new Hono();
app.use("/*", cors());

// Apply rate limiting middleware to /api/* routes
app.use(
  "/api/*",
  rateLimitMiddleware({
    redis: redis as any,
  }),
);

// Auth middleware — validates JWT from Authorization header,
// populates x-user-id on the request for downstream handlers.
// Skips /health and /api/auth/* paths.
app.use("/api/*", authMiddleware());

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

// ── Engagement Event Logger (for Activity Gate) ──
async function logEngagementEvent(
  userId: string,
  groupId: string,
  eventType: "impulse_created" | "draft_submitted" | "dm_sent" | "invite_used",
) {
  await db.insert(schema.activityEvents).values({
    userId,
    groupId,
    eventType,
  });
}

// ── Compute combined vote weight (tenure × activity gate × vouch × suppression) ──
async function combinedWeight(
  userId: string,
  groupId: string,
): Promise<number> {
  const base = await tenureWeight(userId, groupId);
  if (base === 0) return 0;

  // Fetch engagement events for activity gate
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const events = await db
    .select({ eventType: schema.activityEvents.eventType, createdAt: schema.activityEvents.createdAt })
    .from(schema.activityEvents)
    .where(
      and(
        eq(schema.activityEvents.userId, userId),
        eq(schema.activityEvents.groupId, groupId),
        gt(schema.activityEvents.createdAt, cutoff),
      ),
    );

  const activityMultiplier = activityGateMultiplier(
    events.map((e) => ({
      eventType: e.eventType as EngagementEvent["eventType"],
      createdAt: e.createdAt,
    })),
  );

  // Check if user is vouched in this group
  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  const isVouched = membership?.isVouched ?? false;

  // Shadow-ban + fraud flag suppression
  const now = new Date();
  const activeBan = await db.query.shadowBans.findFirst({
    where: (sb, { and, eq, or, isNull, gt }) =>
      and(
        eq(sb.userId, userId),
        or(eq(sb.groupId, groupId), isNull(sb.groupId)),
        isNull(sb.liftedAt),
        or(isNull(sb.expiresAt), gt(sb.expiresAt, now)),
      ),
  });

  const fraudResult = (await pg.unsafe(
    `SELECT COUNT(*)::int AS cnt FROM fraud_audit_log
     WHERE action IN ('cohort_flag', 'cross_group_flag')
       AND (user_id = $1
         OR ((action = 'cohort_flag')
           AND details->'userIds' ? $1::text))`,
    [userId],
  )) as Array<{ cnt: number }>;

  const suppressed = applyVoteSuppression(
    combinedVoteWeight(base, activityMultiplier, isVouched),
    !!activeBan,
    fraudResult[0]?.cnt > 0,
  );

  return suppressed;
}

async function updateGroupTier(groupId: string) {
  const count = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, groupId)
  );
  return tierForMemberCount(count);
}

// ── Feed (cursor-based pagination, sort: newest|popular) ──
app.get("/api/feed", async (c) => {
  const minTier = c.req.query("minTier");
  const sort = c.req.query("sort") ?? "newest";
  const cursor = c.req.query("cursor");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);

  const tierOrder = ["fringe", "small", "medium", "large", "huge", "massive"];

  // Build SQL with endorsement count join for cursor-based pagination
  const wheres: string[] = [`m.status = 'active'`];
  const params: any[] = [];

  if (cursor) {
    if (sort === "popular") {
      const delim = cursor.lastIndexOf("_");
      const curEndorse = Number(cursor.slice(0, delim));
      const curCreated = cursor.slice(delim + 1);
      wheres.push(
        `(COALESCE(rt.ec, 0) < $${params.length + 1} OR (COALESCE(rt.ec, 0) = $${params.length + 2} AND m.created_at < $${params.length + 3}::timestamptz))`
      );
      params.push(curEndorse, curEndorse, curCreated);
    } else {
      wheres.push(`m.created_at < $${params.length + 1}::timestamptz`);
      params.push(cursor);
    }
  }

  const orderBy =
    sort === "popular"
      ? "COALESCE(rt.ec, 0) DESC, m.created_at DESC"
      : "m.created_at DESC";

  if (minTier) {
    const pt = params.length + 1;
    wheres.push(
      `EXISTS (SELECT 1 FROM memberships mem2 WHERE mem2.group_id = m.group_id GROUP BY mem2.group_id HAVING CASE WHEN COUNT(*) >= 10000 THEN 'massive' WHEN COUNT(*) >= 1000 THEN 'huge' WHEN COUNT(*) >= 200 THEN 'large' WHEN COUNT(*) >= 50 THEN 'medium' WHEN COUNT(*) >= 5 THEN 'small' ELSE 'fringe' END >= $${pt}::text)`
    );
    params.push(minTier);
  }

  const sql = `
    SELECT m.id, m.impulse_id, m.group_id, m.target_group_id, m.target_post_id,
           m.content, m.status, m.revoked_at, m.created_at,
           COALESCE(rt.ec, 0) AS endorsement_count
    FROM messages m
    LEFT JOIN (SELECT message_id, COUNT(*) AS ec FROM retweets GROUP BY message_id) rt ON rt.message_id = m.id
    WHERE ${wheres.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
  `;

  const rows = await pg.unsafe(sql, params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    const created = last.created_at instanceof Date ? last.created_at.toISOString() : String(last.created_at);
    nextCursor = sort === "popular" ? `${last.endorsement_count}_${created}` : created;
  }

  // Enrich with group (incl. energy), targetGroup (incl. energy + nickname),
  // parentPost (thread indicator), and post-hoc tier verification
  const enriched = await Promise.all(
    page.map(async (row: any) => {
      const [group, targetGroup, parentMsg] = await Promise.all([
        db.query.groups.findFirst({ where: (g, { eq }) => eq(g.id, row.group_id) }),
        row.target_group_id
          ? db.query.groups.findFirst({ where: (g, { eq }) => eq(g.id, row.target_group_id) })
          : Promise.resolve(null),
        row.target_post_id
          ? db.query.messages.findFirst({
              where: (m, { eq }) => eq(m.id, row.target_post_id),
              with: { group: true },
            })
          : Promise.resolve(null),
      ]);

      if (minTier && group) {
        const cnt = await db.$count(schema.memberships, eq(schema.memberships.groupId, group.id));
        const { tierForMemberCount } = await import("@groupthink/shared");
        const gTier = tierForMemberCount(cnt);
        if (tierOrder.indexOf(gTier) < tierOrder.indexOf(minTier)) return null;
      }

      // Look up group nickname: does the source group have a nickname for the target group?
      let nickname: string | null = null;
      if (row.target_group_id) {
        const gn = await db.query.groupNicknames.findFirst({
          where: (n, { and, eq }) =>
            and(eq(n.sourceGroupId, row.group_id), eq(n.targetGroupId, row.target_group_id)),
        });
        if (gn) nickname = gn.nickname;
      }

      // Build parentPost for thread indicator
      let parentPost: { id: string; content: string; group: { id: string; name: string } } | null = null;
      if (parentMsg) {
        parentPost = {
          id: parentMsg.id,
          content: parentMsg.content,
          group: parentMsg.group
            ? { id: parentMsg.group.id, name: parentMsg.group.name }
            : { id: "", name: "unknown" },
        };
      }

      return {
        id: row.id,
        impulseId: row.impulse_id,
        content: row.content,
        status: row.status,
        revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at ?? null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        group: group
          ? { id: group.id, name: group.name, bio: group.bio, energy: group.energy }
          : null,
        targetGroup: targetGroup
          ? { id: targetGroup.id, name: targetGroup.name, energy: targetGroup.energy }
          : null,
        endorsements: Number(row.endorsement_count),
        nickname,
        parentPost,
      };
    })
  );

  const messages = enriched.filter(Boolean);

  if (messages.length === 0 && hasMore) {
    return c.json({ messages: [], nextCursor: null });
  }

  return c.json({ messages, nextCursor });
});

// ── Auth ──
app.post("/api/auth/register", async (c) => {
  const { provider, providerId, username, turnstileToken } = await c.req.json();
  if (!provider || !providerId || !username) {
    return c.json({ error: "provider, providerId, and username required" }, 400);
  }

  // Sanitize username and providerId
  const sanitizedUsername = sanitizeText(username).slice(0, MAX_LENGTHS.username);
  const sanitizedProviderId = sanitizeText(providerId).slice(0, 255);

  if (!isValidUsername(sanitizedUsername)) {
    return c.json({ error: "username must be 2–30 alphanumeric characters (underscores allowed)" }, 400);
  }

  // Cloudflare Turnstile verification on sign-up
  if (turnstileToken) {
    const valid = await verifyTurnstile(turnstileToken);
    if (!valid) {
      return c.json({ error: "turnstile verification failed" }, 400);
    }
  }

  const existing = await db.query.users.findFirst({
    where: (u, { or, and, eq }) =>
      or(
        and(eq(u.oauthProvider, provider), eq(u.oauthId, sanitizedProviderId)),
        eq(u.username, sanitizedUsername)
      ),
  });
  if (existing) {
    return c.json({ error: "user already exists" }, 409);
  }

  const user = await db.insert(schema.users).values({
    oauthProvider: provider,
    oauthId: sanitizedProviderId,
    username: sanitizedUsername,
  }).returning();

  await auditLog(db)
    .action(AuditActions.UserRegister)
    .user(user[0].id)
    .detail({ provider, username: sanitizedUsername })
    .captureRequest(c)
    .log();

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

  // Log engagement event for activity gate
  await logEngagementEvent(userId, invite.groupId, "invite_used");

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

  // Log engagement event for activity gate
  await logEngagementEvent(userId, groupId, "impulse_created");

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

  // ── Compute combined voting weight ──
  // Applies tenure × activity gate multiplier × vouch boost × suppression
  const weight = await combinedWeight(userId, impulse.groupId);

  // ── Record or update vote ──
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

  // ── Adaptive timer recalculation ──
  const memberCount = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, impulse.groupId),
  );

  const allVotes = await db
    .select()
    .from(schema.votes)
    .where(eq(schema.votes.impulseId, input.impulseId));

  const elapsedMs = Date.now() - new Date(impulse.createdAt).getTime();
  const remaining = adaptiveRemaining({
    totalMembers: memberCount,
    votesCast: allVotes.length,
    yesVotes: allVotes.filter((v) => v.vote === "yes").length,
    noVotes: allVotes.filter((v) => v.vote === "no").length,
    elapsedMs,
  });

  const newVotingEndsAt = new Date(Date.now() + remaining);
  await db
    .update(schema.impulses)
    .set({ votingEndsAt: newVotingEndsAt })
    .where(eq(schema.impulses.id, input.impulseId));

  await redis.publish(
    `impulse:${input.impulseId}:votes`,
    JSON.stringify({ count: allVotes.length }),
  );

  return c.json({ ok: true, voteCount: allVotes.length, votingEndsAt: newVotingEndsAt.toISOString() });
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

  // Log engagement event for activity gate
  await logEngagementEvent(userId, impulse.groupId, "draft_submitted");

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

// ── Message Report ──
app.post("/api/messages/:id/report", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const messageId = c.req.param("id");

  const message = await db.query.messages.findFirst({
    where: (m, { eq }) => eq(m.id, messageId),
  });
  if (!message) return c.json({ error: "message not found" }, 404);
  if (message.status !== "active") {
    return c.json({ error: "can only report active messages" }, 400);
  }

  const { reason } = await c.req.json();
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length === 0)) {
    return c.json({ error: "reason must be a non-empty string if provided" }, 400);
  }

  const report = await db.insert(schema.messageReports).values({
    messageId,
    reportedBy: userId,
    reason: reason?.trim() ?? null,
  }).returning();

  const created = await db.query.messageReports.findFirst({
    where: (r, { eq }) => eq(r.id, report[0].id),
  });

  return c.json(created, 201);
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

/** Global search — groups and public messages */
app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.toLowerCase();
  if (!q) return c.json({ groups: [], messages: [] });

  const groups = await db.query.groups.findMany({
    where: (g, { or, ilike }) =>
      or(ilike(g.name, `%${q}%`), ilike(g.bio, `%${q}%`)),
    limit: 20,
  });

  const messages = await db.query.messages.findMany({
    where: (m, { and, eq }) =>
      and(
        eq(m.status, "active"),
        sql`${m.searchVector} @@ plainto_tsquery('english', ${q})`
      ),
    limit: 20,
  });

  return c.json({ groups, messages });
});

/** Intra-group search — impulses, drafts, members within the user's own groups */
app.get("/api/search/groups", async (c) => {
  const q = c.req.query("q")?.toLowerCase();
  const userId = c.req.header("x-user-id") ?? "";
  if (!q) return c.json({ groups: [], messages: [] });

  // Find the user's group IDs
  const userGroups = await db.query.memberships.findMany({
    where: (m, { eq }) => eq(m.userId, userId),
    columns: { groupId: true },
  });
  const groupIds = userGroups.map((g) => g.groupId);

  if (groupIds.length === 0) return c.json({ groups: [], messages: [] });

  // Search within member groups
  const groups = await db.query.groups.findMany({
    where: (g, { inArray, or, ilike }) =>
      and(inArray(g.id, groupIds), or(ilike(g.name, `%${q}%`), ilike(g.bio, `%${q}%`))),
    limit: 20,
  });

  // Search impulses within member groups
  const messages = await db.query.messages.findMany({
    where: (m, { inArray, and, eq }) =>
      and(
        inArray(m.groupId, groupIds),
        eq(m.status, "active"),
        sql`${m.searchVector} @@ plainto_tsquery('english', ${q})`
      ),
    limit: 20,
  });

  return c.json({ groups, messages });
});

// ── User Profile ──
app.get("/api/users/:id/profile", async (c) => {
  const userId = c.req.param("id");

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  if (!user) return c.json({ error: "not found" }, 404);

  // Group memberships with group info and tenure
  const memberships = await db.query.memberships.findMany({
    where: (m, { eq }) => eq(m.userId, userId),
    with: { group: true },
    orderBy: (m, { desc }) => [desc(m.joinedAt)],
  });

  const groupsWithTenure = memberships.map((m) => {
    const daysSinceJoining = Math.floor(
      (Date.now() - m.joinedAt.getTime()) / 86400000
    );
    return {
      membershipId: m.id,
      groupId: m.group.id,
      groupName: m.group.name,
      groupEnergy: m.group.energy,
      groupBio: m.group.bio,
      isVouched: m.isVouched,
      joinedAt: m.joinedAt.toISOString(),
      tenureDays: daysSinceJoining,
    };
  });

  // Recent public messages by this user (via impulses they created)
  const msgRows = await pg.unsafe(
    `SELECT m.id, m.content, m.created_at, m.group_id, m.status
     FROM messages m
     JOIN impulses i ON i.id = m.impulse_id
     WHERE i.created_by = $1 AND m.status = 'active'
     ORDER BY m.created_at DESC
     LIMIT 20`,
    [userId]
  );

  const enrichedMessages = await Promise.all(
    msgRows.map(async (row: any) => {
      const group = await db.query.groups.findFirst({
        where: (g, { eq }) => eq(g.id, row.group_id),
      });
      return {
        id: row.id,
        content: row.content,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        group: group
          ? { id: group.id, name: group.name, energy: group.energy }
          : null,
        status: row.status,
      };
    })
  );

  const userMsgCount = (
    await pg.unsafe(
      `SELECT COUNT(*) AS cnt FROM messages m JOIN impulses i ON i.id = m.impulse_id WHERE i.created_by = $1 AND m.status = 'active'`,
      [userId]
    )
  )[0]?.cnt ?? 0;

  const totalVotesCast = await db.$count(
    schema.votes,
    eq(schema.votes.userId, userId)
  );

  const totalImpulsesCreated = await db.$count(
    schema.impulses,
    eq(schema.impulses.createdBy, userId)
  );

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      oauthProvider: user.oauthProvider,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
      lastActiveAt: user.lastActiveAt?.toISOString?.() ?? null,
      reputation: user.reputation,
    },
    groups: groupsWithTenure,
    messages: enrichedMessages,
    stats: {
      messagesBroadcast: Number(userMsgCount),
      votesCast: totalVotesCast,
      impulsesCreated: totalImpulsesCreated,
    },
  });
});

// ── Direct Messages ──

// Send a DM
app.post("/api/dms", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json();
  const input = SendDMInput.parse(body);

  // Sender must be a member of the group
  const senderMembership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, input.groupId)),
  });
  if (!senderMembership) return c.json({ error: "not a member of this group" }, 403);

  // Recipient must also be a member of the group
  const recipientMembership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, input.recipientId), eq(m.groupId, input.groupId)),
  });
  if (!recipientMembership) return c.json({ error: "recipient is not a member of this group" }, 400);

  // Cannot DM yourself
  if (userId === input.recipientId) return c.json({ error: "cannot send DM to yourself" }, 400);

  const dm = await db.insert(schema.directMessages).values({
    groupId: input.groupId,
    senderId: userId,
    recipientId: input.recipientId,
    content: input.content,
  }).returning();

  // Log engagement event for activity gate
  await logEngagementEvent(userId, input.groupId, "dm_sent");

  const created = dm[0];
  const [sender, recipient] = await Promise.all([
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, created.senderId) }),
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, created.recipientId) }),
  ]);

  return c.json({
    id: created.id,
    groupId: created.groupId,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    sender: sender ? { id: sender.id, username: sender.username } : null,
    recipient: recipient ? { id: recipient.id, username: recipient.username } : null,
  }, 201);
});

// DM Inbox — list all conversations the user participates in, latest message first
app.get("/api/dms", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // Fetch all DMs where the user is sender or recipient, latest first
  const sql = `
    SELECT dm.id, dm.group_id, dm.sender_id, dm.recipient_id, dm.content, dm.created_at,
           u1.username AS sender_username,
           u2.username AS recipient_username,
           g.name AS group_name
    FROM direct_messages dm
    JOIN users u1 ON u1.id = dm.sender_id
    JOIN users u2 ON u2.id = dm.recipient_id
    JOIN groups g ON g.id = dm.group_id
    WHERE dm.sender_id = $1 OR dm.recipient_id = $1
    ORDER BY dm.created_at DESC
  `;

  const rows = await pg.unsafe(sql, [userId]);

  // Deduplicate to one entry per conversation (pair of users within a group)
  const seen = new Set<string>();
  const conversations: any[] = [];

  for (const row of rows) {
    const userA = row.sender_id < row.recipient_id ? row.sender_id : row.recipient_id;
    const userB = row.sender_id < row.recipient_id ? row.recipient_id : row.sender_id;
    const key = `${row.group_id}:${userA}:${userB}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const otherUser = row.sender_id === userId
      ? { id: row.recipient_id, username: row.recipient_username }
      : { id: row.sender_id, username: row.sender_username };

    conversations.push({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      content: row.content,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      otherUser,
    });
  }

  return c.json({ conversations });
});

// Thread view for a DM conversation
app.get("/api/dms/:id", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const dmId = c.req.param("id");

  const dm = await db.query.directMessages.findFirst({
    where: (d, { eq }) => eq(d.id, dmId),
  });
  if (!dm) return c.json({ error: "not found" }, 404);

  // User must be sender or recipient
  if (dm.senderId !== userId && dm.recipientId !== userId) {
    return c.json({ error: "not authorized" }, 403);
  }

  // Get all messages in this conversation (between the same two users in the same group)
  const messages = await db.query.directMessages.findMany({
    where: (d, { and, eq, or }) => and(
      eq(d.groupId, dm.groupId),
      or(
        and(eq(d.senderId, dm.senderId), eq(d.recipientId, dm.recipientId)),
        and(eq(d.senderId, dm.recipientId), eq(d.recipientId, dm.senderId)),
      ),
    ),
    orderBy: (d, { asc }) => [asc(d.createdAt)],
  });

  const [sender, recipient, group] = await Promise.all([
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, dm.senderId) }),
    db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, dm.recipientId) }),
    db.query.groups.findFirst({ where: (g, { eq }) => eq(g.id, dm.groupId) }),
  ]);

  return c.json({
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      recipientId: m.recipientId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    sender: sender ? { id: sender.id, username: sender.username } : null,
    recipient: recipient ? { id: recipient.id, username: recipient.username } : null,
    group: group ? { id: group.id, name: group.name } : null,
  });
});

// ── Account Settings ──
app.patch("/api/users/me", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const { username } = await c.req.json();

  if (username !== undefined) {
    if (typeof username !== "string" || username.length < 2 || username.length > 30) {
      return c.json({ error: "username must be 2–30 characters" }, 400);
    }

    // Check uniqueness
    const existing = await db.query.users.findFirst({
      where: (u, { and, eq, ne }) =>
        and(eq(u.username, username), ne(u.id, userId)),
    });
    if (existing) {
      return c.json({ error: "username already taken" }, 409);
    }

    await db
      .update(schema.users)
      .set({ username })
      .where(eq(schema.users.id, userId));
  }

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  return c.json(user);
});

// ── Admin: Banned Words ──
app.get("/api/admin/banned-words", async (c) => {
  const words = await db.query.bannedWords.findMany({
    orderBy: (bw, { desc }) => [desc(bw.createdAt)],
    with: { addedByUser: true },
  });
  return c.json(words);
});

app.post("/api/admin/banned-words", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const { word } = await c.req.json();
  if (!word || typeof word !== "string" || word.trim().length === 0) {
    return c.json({ error: "word is required" }, 400);
  }

  const trimmed = word.trim().toLowerCase();

  const existing = await db.query.bannedWords.findFirst({
    where: (bw, { eq }) => eq(bw.word, trimmed),
  });
  if (existing) return c.json({ error: "word already banned" }, 400);

  const banned = await db.insert(schema.bannedWords).values({
    word: trimmed,
    addedBy: userId,
  }).returning();

  const created = await db.query.bannedWords.findFirst({
    where: (bw, { eq }) => eq(bw.id, banned[0].id),
    with: { addedByUser: true },
  });

  return c.json(created, 201);
});

app.delete("/api/admin/banned-words/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await db.query.bannedWords.findFirst({
    where: (bw, { eq }) => eq(bw.id, id),
  });
  if (!existing) return c.json({ error: "not found" }, 404);

  await db.delete(schema.bannedWords).where(eq(schema.bannedWords.id, id));
  return c.json({ ok: true });
});

// ── Admin: Fraud Audit Log ──
app.get("/api/admin/fraud-audit-log", async (c) => {
  const cursor = c.req.query("cursor");
  const action = c.req.query("action");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);

  const wheres: string[] = [];
  const params: any[] = [];

  if (action) {
    const pIdx = params.length + 1;
    wheres.push(`fal.action = $${pIdx}::text`);
    params.push(action);
  }

  if (cursor) {
    const pIdx = params.length + 1;
    wheres.push(`fal.created_at < $${pIdx}::timestamptz`);
    params.push(cursor);
  }

  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  const sql = `
    SELECT fal.id, fal.action, fal.user_id, fal.group_id, fal.details, fal.created_by, fal.created_at,
           u.username AS user_username
    FROM fraud_audit_log fal
    LEFT JOIN users u ON u.id = fal.user_id
    ${whereClause}
    ORDER BY fal.created_at DESC
    LIMIT ${limit + 1}
  `;

  const rows = await pg.unsafe(sql, params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor =
      last.created_at instanceof Date
        ? last.created_at.toISOString()
        : String(last.created_at);
  }

  return c.json({ entries: page, nextCursor });
});

// ── User Profiles ──
app.get("/api/users/:id", async (c) => {
  const userId = c.req.param("id");
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, userId),
  });
  if (!user) return c.json({ error: "not found" }, 404);

  const memberCount = await db.$count(
    schema.memberships,
    eq(schema.memberships.userId, userId)
  );

  // Calculate tenure days since user was created
  const tenureDays = Math.floor(
    (Date.now() - user.createdAt.getTime()) / 86400000
  );

  return c.json({
    ...user,
    memberCount,
    tenureDays,
  });
});

app.get("/api/users/:id/memberships", async (c) => {
  const userId = c.req.param("id");

  const memberships = await db.query.memberships.findMany({
    where: (m, { eq }) => eq(m.userId, userId),
    with: { group: true },
    orderBy: (m, { desc }) => [desc(m.joinedAt)],
  });

  // Attach tenure days for each membership
  const enriched = memberships.map((m) => {
    const tenureDays = Math.floor(
      (Date.now() - m.joinedAt.getTime()) / 86400000
    );
    return {
      ...m,
      tenureDays: Math.max(0, tenureDays),
    };
  });

  return c.json(enriched);
});

app.get("/api/users/:id/messages", async (c) => {
  const userId = c.req.param("id");
  const cursor = c.req.query("cursor");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);

  // Find messages from impulses the user created
  const wheres: string[] = [
    `m.status = 'active'`,
    `i.created_by = $1`,
  ];
  const params: any[] = [userId];

  if (cursor) {
    const pIdx = params.length + 1;
    wheres.push(`m.created_at < $${pIdx}::timestamptz`);
    params.push(cursor);
  }

  const sql = `
    SELECT m.id, m.content, m.created_at, m.group_id, m.impulse_id,
           i.title AS impulse_title
    FROM messages m
    JOIN impulses i ON i.id = m.impulse_id
    WHERE ${wheres.join(" AND ")}
    ORDER BY m.created_at DESC
    LIMIT ${limit + 1}
  `;

  const rows = await pg.unsafe(sql, params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Enrich with group info
  const enriched = await Promise.all(
    page.map(async (row: any) => {
      const group = await db.query.groups.findFirst({
        where: (g, { eq }) => eq(g.id, row.group_id),
      });
      return {
        id: row.id,
        content: row.content,
        impulseTitle: row.impulse_title,
        createdAt: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
        group: group ? { id: group.id, name: group.name } : null,
      };
    })
  );

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor =
      last.created_at instanceof Date
        ? last.created_at.toISOString()
        : String(last.created_at);
  }

  return c.json({ messages: enriched, nextCursor });
});

// ── Governance: Vote-Kick ──

function calculateExpiry(hours = 48): Date {
  return new Date(Date.now() + hours * 3600000);
}

async function totalNonAbstainWeight(
  records: { vote: string; weight: number }[],
): Promise<number> {
  return records
    .filter((r) => r.vote !== "abstain")
    .reduce((sum, r) => sum + r.weight, 0);
}

async function executeKick(kickVoteId: string): Promise<void> {
  const kv = await db.query.kickVotes.findFirst({
    where: (k, { eq }) => eq(k.id, kickVoteId),
  });
  if (!kv || kv.status !== "active") return;

  const records = await db.query.kickVoteRecords.findMany({
    where: (r, { eq }) => eq(r.kickVoteId, kickVoteId),
  });

  const totalWeight = await totalNonAbstainWeight(records);
  const yesWeight = records
    .filter((r) => r.vote === "yes")
    .reduce((s, r) => s + r.weight, 0);

  // Majority: yes > 50% of non-abstain weight
  if (totalWeight > 0 && yesWeight > totalWeight / 2) {
    await db.update(schema.kickVotes)
      .set({ status: "executed" })
      .where(eq(schema.kickVotes.id, kickVoteId));

    // Remove the target from the group
    const membership = await db.query.memberships.findFirst({
      where: (m, { and, eq }) =>
        and(eq(m.userId, kv.targetUserId), eq(m.groupId, kv.groupId)),
    });
    if (membership) {
      await db.delete(schema.memberships)
        .where(eq(schema.memberships.id, membership.id));
    }
  } else {
    await db.update(schema.kickVotes)
      .set({ status: "expired" })
      .where(eq(schema.kickVotes.id, kickVoteId));
  }
}

app.post("/api/groups/:id/kick", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetUserId, reason } = await c.req.json();
  if (!targetUserId) return c.json({ error: "targetUserId required" }, 400);

  // Must be a member
  const [initiator, target] = await Promise.all([
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
    }),
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, targetUserId), eq(m.groupId, groupId)),
    }),
  ]);
  if (!initiator) return c.json({ error: "not a member" }, 403);
  if (!target) return c.json({ error: "target is not a member" }, 400);
  if (targetUserId === userId) return c.json({ error: "cannot kick yourself" }, 400);

  // Check no active kick vote already against this target
  const existing = await db.query.kickVotes.findFirst({
    where: (k, { and, eq }) =>
      and(eq(k.groupId, groupId), eq(k.targetUserId, targetUserId), eq(k.status, "active")),
  });
  if (existing) return c.json({ error: "active kick vote already exists for this user" }, 400);

  const kick = await db.insert(schema.kickVotes).values({
    groupId,
    targetUserId,
    initiatedBy: userId,
    reason: reason || "",
    expiresAt: calculateExpiry(48),
  }).returning();

  return c.json(kick[0], 201);
});

app.post("/api/kick-votes/:id/vote", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const kickVoteId = c.req.param("id");
  const { vote } = await c.req.json();
  if (!["yes", "no", "abstain"].includes(vote)) {
    return c.json({ error: "vote must be yes, no, or abstain" }, 400);
  }

  const kv = await db.query.kickVotes.findFirst({
    where: (k, { eq }) => eq(k.id, kickVoteId),
  });
  if (!kv) return c.json({ error: "kick vote not found" }, 404);
  if (kv.status !== "active") return c.json({ error: "kick vote is not active" }, 400);
  if (kv.targetUserId === userId) return c.json({ error: "cannot vote on your own kick" }, 400);

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, kv.groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  const weight = await tenureWeight(userId, kv.groupId);

  // Upsert vote
  const existing = await db.query.kickVoteRecords.findFirst({
    where: (r, { and, eq }) => and(eq(r.kickVoteId, kickVoteId), eq(r.userId, userId)),
  });
  if (existing) {
    await db.update(schema.kickVoteRecords)
      .set({ vote, weight })
      .where(eq(schema.kickVoteRecords.id, existing.id));
  } else {
    await db.insert(schema.kickVoteRecords).values({
      kickVoteId,
      userId,
      vote,
      weight,
    });
  }

  // Check if threshold reached
  const records = await db.query.kickVoteRecords.findMany({
    where: (r, { eq }) => eq(r.kickVoteId, kickVoteId),
  });
  const totalWeight = await totalNonAbstainWeight(records);
  const yesWeight = records
    .filter((r) => r.vote === "yes")
    .reduce((s, r) => s + r.weight, 0);

  // Execute immediately if threshold met
  if (totalWeight > 0 && yesWeight > totalWeight / 2) {
    await executeKick(kickVoteId);
  }

  return c.json({ ok: true });
});

app.get("/api/kick-votes/:id", async (c) => {
  const kv = await db.query.kickVotes.findFirst({
    where: (k, { eq }) => eq(k.id, c.req.param("id")),
    with: {
      group: true,
      targetUser: true,
      initiatedByUser: true,
      records: { with: { user: true } },
    },
  });
  if (!kv) return c.json({ error: "not found" }, 404);

  const totalWeight = await totalNonAbstainWeight(kv.records);
  const yesWeight = kv.records
    .filter((r) => r.vote === "yes")
    .reduce((s, r) => s + r.weight, 0);
  const noWeight = kv.records
    .filter((r) => r.vote === "no")
    .reduce((s, r) => s + r.weight, 0);

  return c.json({
    ...kv,
    tally: { yesWeight, noWeight, totalWeight },
  });
});

// ── Governance: Group Split ──

async function executeSplit(splitVoteId: string): Promise<void> {
  const sv = await db.query.splitVotes.findFirst({
    where: (s, { eq }) => eq(s.id, splitVoteId),
  });
  if (!sv || sv.status !== "active") return;

  const selections = await db.query.splitSelections.findMany({
    where: (s, { eq }) => eq(s.splitVoteId, splitVoteId),
  });

  const staying = selections.filter((s) => s.chooseOriginal);
  const splintering = selections.filter((s) => !s.chooseOriginal);

  // Only execute if there's a meaningful split (at least 1 on each side)
  if (staying.length === 0 || splintering.length === 0) {
    await db.update(schema.splitVotes)
      .set({ status: "expired" })
      .where(eq(schema.splitVotes.id, splitVoteId));
    return;
  }

  // Create the splinter group
  const newGroup = await db.insert(schema.groups).values({
    name: sv.newGroupName,
    bio: "",
    energy: "mixed",
  }).returning();

  // Move splinter members to the new group
  for (const sel of splintering) {
    await db.delete(schema.memberships)
      .where(and(eq(schema.memberships.userId, sel.userId), eq(schema.memberships.groupId, sv.groupId)));
    await db.insert(schema.memberships).values({
      userId: sel.userId,
      groupId: newGroup[0].id,
    });
  }

  await db.update(schema.splitVotes)
    .set({ status: "executed" })
    .where(eq(schema.splitVotes.id, splitVoteId));
}

app.post("/api/groups/:id/split", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { newGroupName } = await c.req.json();
  if (!newGroupName) return c.json({ error: "newGroupName required" }, 400);

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  // Check no active split
  const existing = await db.query.splitVotes.findFirst({
    where: (s, { and, eq }) => and(eq(s.groupId, groupId), eq(s.status, "active")),
  });
  if (existing) return c.json({ error: "active split vote already exists" }, 400);

  // Check group name is unique
  const nameConflict = await db.query.groups.findFirst({
    where: (g, { eq }) => eq(g.name, newGroupName),
  });
  if (nameConflict) return c.json({ error: "group name already taken" }, 400);

  const split = await db.insert(schema.splitVotes).values({
    groupId,
    initiatedBy: userId,
    newGroupName,
    expiresAt: calculateExpiry(48),
  }).returning();

  return c.json(split[0], 201);
});

app.post("/api/split-votes/:id/select", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const splitVoteId = c.req.param("id");
  const { chooseOriginal } = await c.req.json();
  if (typeof chooseOriginal !== "boolean") {
    return c.json({ error: "chooseOriginal (boolean) required" }, 400);
  }

  const sv = await db.query.splitVotes.findFirst({
    where: (s, { eq }) => eq(s.id, splitVoteId),
  });
  if (!sv) return c.json({ error: "split vote not found" }, 404);
  if (sv.status !== "active") return c.json({ error: "split vote is not active" }, 400);

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, sv.groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  // Upsert selection
  const existing = await db.query.splitSelections.findFirst({
    where: (s, { and, eq }) => and(eq(s.splitVoteId, splitVoteId), eq(s.userId, userId)),
  });
  if (existing) {
    await db.update(schema.splitSelections)
      .set({ chooseOriginal })
      .where(eq(schema.splitSelections.id, existing.id));
  } else {
    await db.insert(schema.splitSelections).values({
      splitVoteId,
      userId,
      chooseOriginal,
    });
  }

  // Check if all members have selected
  const memberCount = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, sv.groupId)
  );
  const selectionCount = await db.$count(
    schema.splitSelections,
    eq(schema.splitSelections.splitVoteId, splitVoteId)
  );

  if (selectionCount >= memberCount) {
    await executeSplit(splitVoteId);
  }

  return c.json({ ok: true });
});

app.get("/api/split-votes/:id", async (c) => {
  const sv = await db.query.splitVotes.findFirst({
    where: (s, { eq }) => eq(s.id, c.req.param("id")),
    with: {
      group: true,
      initiatedByUser: true,
      selections: { with: { user: true } },
    },
  });
  if (!sv) return c.json({ error: "not found" }, 404);

  const memberCount = await db.$count(
    schema.memberships,
    eq(schema.memberships.groupId, sv.groupId)
  );

  return c.json({
    ...sv,
    memberCount,
    selectionsCount: sv.selections.length,
    stayingCount: sv.selections.filter((s) => s.chooseOriginal).length,
    splinteringCount: sv.selections.filter((s) => !s.chooseOriginal).length,
  });
});

// ── Governance: Group Merge ──

async function checkAndExecuteMerge(mergeVoteId: string): Promise<void> {
  const mv = await db.query.mergeVotes.findFirst({
    where: (m, { eq }) => eq(m.id, mergeVoteId),
  });
  if (!mv || mv.status !== "active") return;

  const approvals = await db.query.mergeApprovals.findMany({
    where: (a, { eq }) => eq(a.mergeVoteId, mergeVoteId),
  });

  // Need at least one approval from each group
  const initiatorApprovals = approvals.filter((a) => a.groupId === mv.initiatedByGroupId);
  const targetApprovals = approvals.filter((a) => a.groupId === mv.targetGroupId);

  const initiatorApproved = initiatorApprovals.some((a) => a.approved);
  const targetApproved = targetApprovals.some((a) => a.approved);

  const initiatorRejected = initiatorApprovals.some((a) => !a.approved);
  const targetRejected = targetApprovals.some((a) => !a.approved);

  if (initiatorRejected || targetRejected) {
    // Anyone rejecting blocks the merge
    await db.update(schema.mergeVotes)
      .set({ status: "rejected" })
      .where(eq(schema.mergeVotes.id, mergeVoteId));
    return;
  }

  if (initiatorApproved && targetApproved) {
    // Both groups approve — merge them
    // Move all members from target group into initiator group, deactivate target
    const targetMembers = await db.query.memberships.findMany({
      where: (m, { eq }) => eq(m.groupId, mv.targetGroupId),
    });

    for (const tm of targetMembers) {
      const alreadyMember = await db.query.memberships.findFirst({
        where: (m, { and, eq }) =>
          and(eq(m.userId, tm.userId), eq(m.groupId, mv.initiatedByGroupId)),
      });
      if (!alreadyMember) {
        await db.insert(schema.memberships).values({
          userId: tm.userId,
          groupId: mv.initiatedByGroupId,
        });
      }
    }

    // Mark the target group as merged / clear it
    await db.update(schema.groups)
      .set({ bio: "[merged]" })
      .where(eq(schema.groups.id, mv.targetGroupId));

    await db.update(schema.mergeVotes)
      .set({ status: "approved" })
      .where(eq(schema.mergeVotes.id, mergeVoteId));
  }
}

app.post("/api/groups/:id/merge", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetGroupId } = await c.req.json();
  if (!targetGroupId) return c.json({ error: "targetGroupId required" }, 400);
  if (targetGroupId === groupId) return c.json({ error: "cannot merge with yourself" }, 400);

  const [initiatorMembership, targetGroup] = await Promise.all([
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
    }),
    db.query.groups.findFirst({
      where: (g, { eq }) => eq(g.id, targetGroupId),
    }),
  ]);
  if (!initiatorMembership) return c.json({ error: "not a member" }, 403);
  if (!targetGroup) return c.json({ error: "target group not found" }, 404);

  // Check no active merge between these groups
  const existing = await db.query.mergeVotes.findFirst({
    where: (m, { and, or, eq }) =>
      and(
        or(
          and(eq(m.initiatedByGroupId, groupId), eq(m.targetGroupId, targetGroupId)),
          and(eq(m.initiatedByGroupId, targetGroupId), eq(m.targetGroupId, groupId)),
        ),
        eq(m.status, "active"),
      ),
  });
  if (existing) return c.json({ error: "active merge vote already exists between these groups" }, 400);

  const merge = await db.insert(schema.mergeVotes).values({
    initiatedByGroupId: groupId,
    targetGroupId,
    initiatedBy: userId,
    expiresAt: calculateExpiry(72), // 72h for merges — needs time for mutual vote
  }).returning();

  return c.json(merge[0], 201);
});

app.post("/api/merge-votes/:id/approve", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const mergeVoteId = c.req.param("id");
  const { approved } = await c.req.json();
  if (typeof approved !== "boolean") {
    return c.json({ error: "approved (boolean) required" }, 400);
  }

  const mv = await db.query.mergeVotes.findFirst({
    where: (m, { eq }) => eq(m.id, mergeVoteId),
  });
  if (!mv) return c.json({ error: "merge vote not found" }, 404);
  if (mv.status !== "active") return c.json({ error: "merge vote is not active" }, 400);

  // Must be a member of either initiator or target group to vote
  const [initiatorMember, targetMember] = await Promise.all([
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, mv.initiatedByGroupId)),
    }),
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, mv.targetGroupId)),
    }),
  ]);

  let userGroupId: string | null = null;
  if (initiatorMember) userGroupId = mv.initiatedByGroupId;
  else if (targetMember) userGroupId = mv.targetGroupId;
  else return c.json({ error: "not a member of either group" }, 403);

  // Upsert approval
  const existing = await db.query.mergeApprovals.findFirst({
    where: (a, { and, eq }) =>
      and(eq(a.mergeVoteId, mergeVoteId), eq(a.userId, userId)),
  });
  if (existing) {
    await db.update(schema.mergeApprovals)
      .set({ approved, castAt: new Date() })
      .where(eq(schema.mergeApprovals.id, existing.id));
  } else {
    await db.insert(schema.mergeApprovals).values({
      mergeVoteId,
      userId,
      groupId: userGroupId,
      approved,
    });
  }

  await checkAndExecuteMerge(mergeVoteId);

  return c.json({ ok: true });
});

app.get("/api/merge-votes/:id", async (c) => {
  const mv = await db.query.mergeVotes.findFirst({
    where: (m, { eq }) => eq(m.id, c.req.param("id")),
    with: {
      initiatedByGroup: true,
      targetGroup: true,
      initiatedByUser: true,
      approvals: { with: { user: true } },
    },
  });
  if (!mv) return c.json({ error: "not found" }, 404);

  const initiatorApprovals = mv.approvals.filter(
    (a) => a.groupId === mv.initiatedByGroupId,
  );
  const targetApprovals = mv.approvals.filter(
    (a) => a.groupId === mv.targetGroupId,
  );

  return c.json({
    ...mv,
    initiatorApprovals,
    targetApprovals,
  });
});

// ── Governance: Sabbatical ──

async function executeSabbatical(sabbaticalVoteId: string): Promise<void> {
  const sv = await db.query.sabbaticalVotes.findFirst({
    where: (s, { eq }) => eq(s.id, sabbaticalVoteId),
  });
  if (!sv || sv.status !== "active") return;

  const records = await db.query.sabbaticalVoteRecords.findMany({
    where: (r, { eq }) => eq(r.sabbaticalVoteId, sabbaticalVoteId),
  });

  const totalWeight = await totalNonAbstainWeight(records);
  const yesWeight = records
    .filter((r) => r.vote === "yes")
    .reduce((s, r) => s + r.weight, 0);

  if (totalWeight > 0 && yesWeight > totalWeight / 2) {
    await db.update(schema.sabbaticalVotes)
      .set({ status: "executed" })
      .where(eq(schema.sabbaticalVotes.id, sabbaticalVoteId));

    if (sv.direction === "enter") {
      // Set sabbaticalUntil on the group
      const until = new Date(Date.now() + (sv.durationHours || 48) * 3600000);
      await db.update(schema.groups)
        .set({ sabbaticalUntil: until })
        .where(eq(schema.groups.id, sv.groupId));
    } else {
      // Exit sabbatical — clear the field
      await db.update(schema.groups)
        .set({ sabbaticalUntil: null })
        .where(eq(schema.groups.id, sv.groupId));
    }
  } else {
    await db.update(schema.sabbaticalVotes)
      .set({ status: "expired" })
      .where(eq(schema.sabbaticalVotes.id, sabbaticalVoteId));
  }
}

app.post("/api/groups/:id/sabbatical", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { direction, durationHours } = await c.req.json();
  if (!direction || !["enter", "exit"].includes(direction)) {
    return c.json({ error: "direction must be 'enter' or 'exit'" }, 400);
  }

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  // Check no active sabbatical vote
  const existing = await db.query.sabbaticalVotes.findFirst({
    where: (s, { and, eq }) => and(eq(s.groupId, groupId), eq(s.status, "active")),
  });
  if (existing) return c.json({ error: "active sabbatical vote already exists" }, 400);

  // If direction is "exit", the group must currently be on sabbatical
  if (direction === "exit") {
    const group = await db.query.groups.findFirst({
      where: (g, { eq }) => eq(g.id, groupId),
    });
    if (!group?.sabbaticalUntil) {
      return c.json({ error: "group is not currently on sabbatical" }, 400);
    }
  }

  if (direction === "enter" && durationHours) {
    if (durationHours < 1 || durationHours > 168) {
      return c.json({ error: "durationHours must be between 1 and 168 (7 days)" }, 400);
    }
  }

  const sabb = await db.insert(schema.sabbaticalVotes).values({
    groupId,
    initiatedBy: userId,
    direction,
    durationHours: direction === "enter" ? (durationHours || 48) : null,
    expiresAt: calculateExpiry(48),
  }).returning();

  return c.json(sabb[0], 201);
});

app.post("/api/sabbatical-votes/:id/vote", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const sabbaticalVoteId = c.req.param("id");
  const { vote } = await c.req.json();
  if (!["yes", "no", "abstain"].includes(vote)) {
    return c.json({ error: "vote must be yes, no, or abstain" }, 400);
  }

  const sv = await db.query.sabbaticalVotes.findFirst({
    where: (s, { eq }) => eq(s.id, sabbaticalVoteId),
  });
  if (!sv) return c.json({ error: "sabbatical vote not found" }, 404);
  if (sv.status !== "active") return c.json({ error: "sabbatical vote is not active" }, 400);

  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, sv.groupId)),
  });
  if (!membership) return c.json({ error: "not a member" }, 403);

  const weight = await tenureWeight(userId, sv.groupId);

  // Upsert
  const existing = await db.query.sabbaticalVoteRecords.findFirst({
    where: (r, { and, eq }) => and(eq(r.sabbaticalVoteId, sabbaticalVoteId), eq(r.userId, userId)),
  });
  if (existing) {
    await db.update(schema.sabbaticalVoteRecords)
      .set({ vote, weight })
      .where(eq(schema.sabbaticalVoteRecords.id, existing.id));
  } else {
    await db.insert(schema.sabbaticalVoteRecords).values({
      sabbaticalVoteId,
      userId,
      vote,
      weight,
    });
  }

  await executeSabbatical(sabbaticalVoteId);

  return c.json({ ok: true });
});

app.get("/api/sabbatical-votes/:id", async (c) => {
  const sv = await db.query.sabbaticalVotes.findFirst({
    where: (s, { eq }) => eq(s.id, c.req.param("id")),
    with: {
      group: true,
      initiatedByUser: true,
      records: { with: { user: true } },
    },
  });
  if (!sv) return c.json({ error: "not found" }, 404);

  const totalWeight = await totalNonAbstainWeight(sv.records);
  const yesWeight = sv.records
    .filter((r) => r.vote === "yes")
    .reduce((s, r) => s + r.weight, 0);
  const noWeight = sv.records
    .filter((r) => r.vote === "no")
    .reduce((s, r) => s + r.weight, 0);

  return c.json({
    ...sv,
    tally: { yesWeight, noWeight, totalWeight },
  });
});

// ── Push Tokens ──

/** Register or update an Expo push token for the current user */
app.post("/api/push-tokens", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const { token, platform } = await c.req.json();
  if (!token || !platform) {
    return c.json({ error: "token and platform are required" }, 400);
  }

  if (!["ios", "android", "web"].includes(platform)) {
    return c.json({ error: "platform must be ios, android, or web" }, 400);
  }

  // Upsert: if the user already has a token for this platform, update it
  const existing = await db.query.pushTokens.findFirst({
    where: (pt, { and, eq }) =>
      and(eq(pt.userId, userId), eq(pt.platform, platform)),
  });

  if (existing) {
    await db
      .update(schema.pushTokens)
      .set({ token })
      .where(eq(schema.pushTokens.id, existing.id));
    return c.json({ ok: true, updated: true });
  }

  await db.insert(schema.pushTokens).values({
    userId,
    token,
    platform,
  });

  return c.json({ ok: true, created: true }, 201);
});

/** Get all registered push tokens for the current user */
app.get("/api/push-tokens", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const tokens = await db.query.pushTokens.findMany({
    where: (pt, { eq }) => eq(pt.userId, userId),
  });
  return c.json({ tokens });
});

/** Delete a push token */
app.delete("/api/push-tokens/:id", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const existing = await db.query.pushTokens.findFirst({
    where: (pt, { and, eq }) => and(eq(pt.id, id), eq(pt.userId, userId)),
  });
  if (!existing) return c.json({ error: "not found" }, 404);

  await db.delete(schema.pushTokens).where(eq(schema.pushTokens.id, id));
  return c.json({ ok: true });
});

// ── In-app Notifications ──

/** List the current user's notifications, newest first, with cursor pagination */
app.get("/api/notifications", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const cursor = c.req.query("cursor");
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);

  const wheres: string[] = ["n.user_id = $1"];
  const params: any[] = [userId];

  if (cursor) {
    const pIdx = params.length + 1;
    wheres.push(`n.created_at < $${pIdx}::timestamptz`);
    params.push(cursor);
  }

  const sql = `
    SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at
    FROM notifications n
    WHERE ${wheres.join(" AND ")}
    ORDER BY n.created_at DESC
    LIMIT ${limit + 1}
  `;

  const rows = await pg.unsafe(sql, params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor =
      last.created_at instanceof Date
        ? last.created_at.toISOString()
        : String(last.created_at);
  }

  const notifications = page.map((row: any) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.read_at?.toISOString?.() ?? null,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  }));

  return c.json({ notifications, nextCursor });
});

/** Mark a single notification as read */
app.post("/api/notifications/:id/read", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const id = c.req.param("id");
  const existing = await db.query.notifications.findFirst({
    where: (n, { and, eq }) => and(eq(n.id, id), eq(n.userId, userId)),
  });
  if (!existing) return c.json({ error: "not found" }, 404);

  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(eq(schema.notifications.id, id));

  return c.json({ ok: true });
});

/** Mark all notifications as read for the current user */
app.post("/api/notifications/read-all", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      )
    );

  return c.json({ ok: true });
});

/** Get unread notification count */
app.get("/api/notifications/unread-count", async (c) => {
  const userId = c.req.header("x-user-id");
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const count = await db.$count(
    schema.notifications,
    and(
      eq(schema.notifications.userId, userId),
      isNull(schema.notifications.readAt),
    )
  );

  return c.json({ count });
});

// ── Notification Creation Helper (used internally) ──

/**
 * Create a notification for a user and optionally send a push notification
 * via Expo Push API.
 */
async function createNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
  sendPush = true,
): Promise<void> {
  await db.insert(schema.notifications).values({
    userId,
    type,
    title,
    body,
  });

  if (!sendPush) return;

  // Fetch user's push tokens
  const tokens = await db.query.pushTokens.findMany({
    where: (pt, { eq }) => eq(pt.userId, userId),
  });

  if (tokens.length === 0) return;

  // Send via Expo Push API
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title,
    body: body ?? title,
    data: { type },
  }));

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("Failed to send push notification:", err);
  }
}

// ── Vouch System ──

/**
 * Vouch for a member — grants them isVouched=true in the group,
 * which accelerates their voting weight via vouchMultiplier.
 * Requires the actor to be an existing member of the group.
 * Logs the action to the fraud audit log.
 */
app.post("/api/groups/:id/vouch", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetUserId } = await c.req.json();
  if (!targetUserId) return c.json({ error: "targetUserId required" }, 400);
  if (targetUserId === userId) return c.json({ error: "cannot vouch for yourself" }, 400);

  // Both users must be members of the group
  const [actorMember, targetMember] = await Promise.all([
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
    }),
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, targetUserId), eq(m.groupId, groupId)),
    }),
  ]);
  if (!actorMember) return c.json({ error: "not a member" }, 403);
  if (!targetMember) return c.json({ error: "target is not a member" }, 400);
  if (targetMember.isVouched) return c.json({ error: "target already vouched" }, 400);

  await db.update(schema.memberships)
    .set({ isVouched: true, vouchedBy: userId })
    .where(eq(schema.memberships.id, targetMember.id));

  // Audit log
  await db.insert(schema.fraudAuditLog).values({
    action: "vouch",
    userId: targetUserId,
    groupId,
    createdBy: userId,
    details: { action: "vouch_added", vouchedBy: userId },
  });

  return c.json({ ok: true }, 200);
});

/**
 * Remove vouch from a member. Requires the original voucher or
 * the vouched user themselves.
 */
app.post("/api/groups/:id/unvouch", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const groupId = c.req.param("id");
  const { targetUserId } = await c.req.json();
  if (!targetUserId) return c.json({ error: "targetUserId required" }, 400);

  const [actorMember, targetMember] = await Promise.all([
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.groupId, groupId)),
    }),
    db.query.memberships.findFirst({
      where: (m, { and, eq }) => and(eq(m.userId, targetUserId), eq(m.groupId, groupId)),
    }),
  ]);
  if (!actorMember) return c.json({ error: "not a member" }, 403);
  if (!targetMember) return c.json({ error: "target is not a member" }, 400);
  if (!targetMember.isVouched) return c.json({ error: "target is not vouched" }, 400);

  // Allow unvouch by: the original voucher, the vouched user themselves
  if (targetMember.vouchedBy !== userId && targetUserId !== userId) {
    return c.json({ error: "not authorized to unvouch" }, 403);
  }

  await db.update(schema.memberships)
    .set({ isVouched: false, vouchedBy: null })
    .where(eq(schema.memberships.id, targetMember.id));

  // Audit log
  await db.insert(schema.fraudAuditLog).values({
    action: "vouch",
    userId: targetUserId,
    groupId,
    createdBy: userId,
    details: { action: "vouch_removed", removedBy: userId },
  });

  return c.json({ ok: true });
});

// ── Shadow-Ban Endpoints ──

/**
 * List all active shadow bans. Supports cursor-based pagination.
 */
app.get("/api/admin/shadow-bans", async (c) => {
  const cursor = c.req.query("cursor");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);

  const wheres: string[] = ["sb.lifted_at IS NULL"];
  const params: any[] = [];

  if (cursor) {
    const pIdx = params.length + 1;
    wheres.push(`sb.created_at < $${pIdx}::timestamptz`);
    params.push(cursor);
  }

  const whereClause = `WHERE ${wheres.join(" AND ")}`;
  const sql = `
    SELECT sb.id, sb.user_id, sb.group_id, sb.reason, sb.shadow_banned_by,
           sb.lifted_by, sb.lifted_at, sb.created_at, sb.expires_at,
           u.username AS user_username
    FROM shadow_bans sb
    LEFT JOIN users u ON u.id = sb.user_id
    ${whereClause}
    ORDER BY sb.created_at DESC
    LIMIT ${limit + 1}
  `;

  const rows = await pg.unsafe(sql, params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor =
      last.created_at instanceof Date
        ? last.created_at.toISOString()
        : String(last.created_at);
  }

  return c.json({ entries: page, nextCursor });
});

/**
 * Create a shadow ban for a user, optionally scoped to a group.
 * Global shadow bans (groupId = null) suppress voting everywhere.
 */
app.post("/api/admin/shadow-bans", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const { targetUserId, groupId, reason, expiresInHours } = await c.req.json();
  if (!targetUserId) return c.json({ error: "targetUserId required" }, 400);

  // Target user must exist
  const targetUser = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, targetUserId),
  });
  if (!targetUser) return c.json({ error: "target user not found" }, 404);

  // Check for existing active shadow ban
  const now = new Date();
  const existing = await db.query.shadowBans.findFirst({
    where: (sb, { and, eq, or, isNull, gt }) =>
      and(
        eq(sb.userId, targetUserId),
        isNull(sb.liftedAt),
        or(isNull(sb.expiresAt), gt(sb.expiresAt, now)),
        groupId ? eq(sb.groupId, groupId) : isNull(sb.groupId),
      ),
  });
  if (existing) return c.json({ error: "active shadow ban already exists" }, 400);

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 3600000)
    : null;

  const ban = await db.insert(schema.shadowBans).values({
    userId: targetUserId,
    groupId: groupId || null,
    reason: reason || null,
    shadowBannedBy: userId,
    expiresAt,
  }).returning();

  const created = ban[0];

  // Audit log
  await db.insert(schema.fraudAuditLog).values({
    action: "shadow_ban",
    userId: targetUserId,
    groupId: groupId || null,
    createdBy: userId,
    details: {
      shadowBanId: created.id,
      reason: reason || null,
      expiresAt: expiresAt?.toISOString() ?? null,
      action: "shadow_ban_created",
    },
  });

  return c.json(created, 201);
});

/**
 * Lift a shadow ban by ID.
 */
app.post("/api/admin/shadow-bans/:id/lift", async (c) => {
  const userId = c.req.header("x-user-id")!;
  const banId = c.req.param("id");

  const ban = await db.query.shadowBans.findFirst({
    where: (sb, { eq }) => eq(sb.id, banId),
  });
  if (!ban) return c.json({ error: "shadow ban not found" }, 404);
  if (ban.liftedAt) return c.json({ error: "shadow ban already lifted" }, 400);

  await db.update(schema.shadowBans)
    .set({ liftedAt: new Date(), liftedBy: userId })
    .where(eq(schema.shadowBans.id, banId));

  // Audit log
  await db.insert(schema.fraudAuditLog).values({
    action: "shadow_ban",
    userId: ban.userId,
    groupId: ban.groupId,
    createdBy: userId,
    details: {
      shadowBanId: banId,
      action: "shadow_ban_lifted",
    },
  });

  return c.json({ ok: true });
});

// ── Health ──

/** Liveness probe — process is alive and responding */
app.get("/health/live", (c) => c.json({ ok: true }));

/** Readiness probe — dependencies are reachable */
app.get("/health/ready", async (c) => {
  const checks: Record<string, string> = {};

  // Check database connectivity
  try {
    await pg`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // Check Redis connectivity
  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const allOk = Object.values(checks).every((s) => s === "ok");
  return c.json(
    { ok: allOk, checks },
    allOk ? 200 : 503
  );
});

/** Legacy health endpoint — redirects to liveness */
app.get("/health", (c) => c.json({ ok: true }));

// ── Impulse Lifecycle Engine ──
import { startLifecycleEngine } from "./lifecycle";
startLifecycleEngine(pg, redis as any);

// ── Fraud Detection Engine ──
import { startFraudDetection } from "./fraud-detection";
startFraudDetection(pg);

// ── Scheduled Jobs ──
import { startScheduledJobs } from "./scheduled-jobs";
startScheduledJobs(pg, redis as any);

const port = Number(process.env.APP_PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`api running on :${port}`);
