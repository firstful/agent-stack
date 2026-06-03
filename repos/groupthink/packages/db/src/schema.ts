import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  doublePrecision,
  customType,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ── Group Blocks ──
export const groupBlocks = pgTable("group_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  blockerGroupId: uuid("blocker_group_id")
    .references(() => groups.id)
    .notNull(),
  blockedGroupId: uuid("blocked_group_id")
    .references(() => groups.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Users ──
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  oauthProvider: text("oauth_provider", { enum: ["google", "github", "apple"] })
    .notNull(),
  oauthId: text("oauth_id").notNull().unique(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  reputation: doublePrecision("reputation").default(1.0).notNull(),
});

// ── Groups ──
export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  bio: text("bio").default(""),
  energy: text("energy", {
    enum: ["thoughtful", "snarky", "funny", "mixed"],
  })
    .notNull()
    .default("thoughtful"),
  timezone: text("timezone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sabbaticalUntil: timestamp("sabbatical_until"),
  lastEnergyChangeAt: timestamp("last_energy_change_at")
    .defaultNow()
    .notNull(),
  minInteractionTier: text("min_interaction_tier", {
    enum: ["fringe", "small", "medium", "large", "huge", "massive"],
  }).default("fringe"),
});

// ── Group Nicknames (group gives another group a flair) ──
export const groupNicknames = pgTable("group_nicknames", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceGroupId: uuid("source_group_id")
    .references(() => groups.id)
    .notNull(),
  targetGroupId: uuid("target_group_id")
    .references(() => groups.id)
    .notNull(),
  nickname: text("nickname").notNull(),
});

// ── Memberships ──
export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  isVouched: boolean("is_vouched").default(false).notNull(),
  vouchedBy: uuid("vouched_by").references(() => users.id),
});

// ── Impulses ──
export const impulses = pgTable("impulses", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  targetGroupId: uuid("target_group_id").references(() => groups.id),
  targetPostId: uuid("target_post_id"),
  title: text("title").notNull(),
  description: text("description").default(""),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  status: text("status", {
    enum: [
      "queued",
      "voting",
      "composing",
      "summarizing",
      "approval",
      "broadcast",
      "expired",
      "discarded",
    ],
  })
    .notNull()
    .default("queued"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  votingEndsAt: timestamp("voting_ends_at"),
  queuePosition: integer("queue_position").default(0),
});

// ── Votes ──
export const votes = pgTable("votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  impulseId: uuid("impulse_id")
    .references(() => impulses.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  vote: text("vote", { enum: ["yes", "no", "abstain"] }).notNull(),
  castAt: timestamp("cast_at").defaultNow().notNull(),
  weight: integer("weight").default(1).notNull(),
});

// ── Drafts (composer phase) ──
export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  impulseId: uuid("impulse_id")
    .references(() => impulses.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  content: text("content").notNull(),
  parentDraftId: uuid("parent_draft_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── LLM Summary Candidates ──
export const summaryCandidates = pgTable("summary_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  impulseId: uuid("impulse_id")
    .references(() => impulses.id)
    .notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Broadcast Messages ──
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  impulseId: uuid("impulse_id")
    .references(() => impulses.id)
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  targetGroupId: uuid("target_group_id").references(() => groups.id),
  targetPostId: uuid("target_post_id"),
  content: text("content").notNull(),
  status: text("status", { enum: ["active", "revoked"] })
    .default("active")
    .notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  searchVector: tsvector("search_vector").generatedAlwaysAs(
    sql`to_tsvector('english', "content")`
  ),
});

// Temporarily commented out — drizzle-kit 0.30.6 can't parse custom type columns
// in index definitions. The GIN index is created manually via SQL migration.
// NOTE: GIN index disabled for load tests — tsvector + .using("gin") throws
//   "SyntaxError: "undefined" is not valid JSON" in drizzle-orm 0.38.4.
// Re-enable after drizzle upgrade or fix.
// export const messagesSearchIndex = index("idx_messages_search")
//   .using("gin", messages.searchVector);

// ── Retweets (Endorsements) ──
export const retweets = pgTable("retweets", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id")
    .references(() => messages.id)
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Invite Codes ──
export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  usedBy: uuid("used_by").references(() => users.id),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// ── Direct Messages ──
export const directMessages = pgTable("direct_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  senderId: uuid("sender_id")
    .references(() => users.id)
    .notNull(),
  recipientId: uuid("recipient_id")
    .references(() => users.id)
    .notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Banned Words ──
export const bannedWords = pgTable("banned_words", {
  id: uuid("id").defaultRandom().primaryKey(),
  word: text("word").notNull().unique(),
  addedBy: uuid("added_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Fraud Audit Log ──
export const fraudAuditLog = pgTable("fraud_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(),
  userId: uuid("user_id").references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id),
  details: jsonb("details"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Message Reports ──
export const messageReports = pgTable("message_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id")
    .references(() => messages.id)
    .notNull(),
  reportedBy: uuid("reported_by")
    .references(() => users.id)
    .notNull(),
  reason: text("reason"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewAction: text("review_action", {
    enum: ["dismissed", "actioned"],
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

// ── Shadow Bans ──
export const shadowBans = pgTable("shadow_bans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  groupId: uuid("group_id").references(() => groups.id),
  reason: text("reason"),
  shadowBannedBy: uuid("shadow_banned_by")
    .references(() => users.id),
  liftedBy: uuid("lifted_by").references(() => users.id),
  liftedAt: timestamp("lifted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

// ── Audit Logs ──
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(),
  userId: uuid("user_id").references(() => users.id),
  groupId: uuid("group_id").references(() => groups.id),
  targetId: text("target_id"),
  details: jsonb("details"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Push Tokens ──
export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  token: text("token").notNull(),
  platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Notifications ──
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Governance: Vote-Kick ──
export const kickVotes = pgTable("kick_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  targetUserId: uuid("target_user_id")
    .references(() => users.id)
    .notNull(),
  initiatedBy: uuid("initiated_by")
    .references(() => users.id)
    .notNull(),
  reason: text("reason").default(""),
  status: text("status", {
    enum: ["active", "executed", "expired"],
  })
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const kickVoteRecords = pgTable("kick_vote_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  kickVoteId: uuid("kick_vote_id")
    .references(() => kickVotes.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  vote: text("vote", { enum: ["yes", "no", "abstain"] }).notNull(),
  weight: integer("weight").default(1).notNull(),
  castAt: timestamp("cast_at").defaultNow().notNull(),
});

// ── Activity Events (for Activity Gate engagement tracking) ──
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  eventType: text("event_type", {
    enum: ["impulse_created", "draft_submitted", "dm_sent", "invite_used"],
  }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Governance: Group Split ──
export const splitVotes = pgTable("split_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  initiatedBy: uuid("initiated_by")
    .references(() => users.id)
    .notNull(),
  newGroupName: text("new_group_name").notNull(),
  status: text("status", {
    enum: ["active", "executed", "expired"],
  })
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const splitSelections = pgTable("split_selections", {
  id: uuid("id").defaultRandom().primaryKey(),
  splitVoteId: uuid("split_vote_id")
    .references(() => splitVotes.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  chooseOriginal: boolean("choose_original").notNull(),
  castAt: timestamp("cast_at").defaultNow().notNull(),
});

// ── Governance: Group Merge ──
export const mergeVotes = pgTable("merge_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  initiatedByGroupId: uuid("initiated_by_group_id")
    .references(() => groups.id)
    .notNull(),
  targetGroupId: uuid("target_group_id")
    .references(() => groups.id)
    .notNull(),
  initiatedBy: uuid("initiated_by")
    .references(() => users.id)
    .notNull(),
  status: text("status", {
    enum: ["active", "approved", "rejected", "expired"],
  })
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const mergeApprovals = pgTable("merge_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  mergeVoteId: uuid("merge_vote_id")
    .references(() => mergeVotes.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  approved: boolean("approved").notNull(),
  castAt: timestamp("cast_at").defaultNow().notNull(),
});

// ── Governance: Sabbatical ──
export const sabbaticalVotes = pgTable("sabbatical_votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .references(() => groups.id)
    .notNull(),
  initiatedBy: uuid("initiated_by")
    .references(() => users.id)
    .notNull(),
  direction: text("direction", { enum: ["enter", "exit"] }).notNull(),
  durationHours: integer("duration_hours").default(48),
  status: text("status", {
    enum: ["active", "executed", "expired"],
  })
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const sabbaticalVoteRecords = pgTable("sabbatical_vote_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  sabbaticalVoteId: uuid("sabbatical_vote_id")
    .references(() => sabbaticalVotes.id)
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  vote: text("vote", { enum: ["yes", "no", "abstain"] }).notNull(),
  weight: integer("weight").default(1).notNull(),
  castAt: timestamp("cast_at").defaultNow().notNull(),
});
