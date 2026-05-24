import { pgTable, uuid, text, integer, timestamp, boolean, } from "drizzle-orm/pg-core";
// ── Users ──
export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    oauthProvider: text("oauth_provider", { enum: ["google", "github", "apple"] })
        .notNull(),
    oauthId: text("oauth_id").notNull().unique(),
    username: text("username").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
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
});
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
//# sourceMappingURL=schema.js.map