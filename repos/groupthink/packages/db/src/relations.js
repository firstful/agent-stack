import { relations } from "drizzle-orm";
import * as s from "./schema";
// ── Groups ──
export const groupsRelations = relations(s.groups, ({ many }) => ({
    memberships: many(s.memberships),
    impulsesFrom: many(s.impulses, { relationName: "impulses_group" }),
    impulsesTargeted: many(s.impulses, { relationName: "impulses_target_group" }),
    messagesFrom: many(s.messages, { relationName: "messages_group" }),
    messagesTargeted: many(s.messages, { relationName: "messages_target_group" }),
    inviteCodes: many(s.inviteCodes),
    sourceNicknames: many(s.groupNicknames, { relationName: "nicknames_source" }),
    targetNicknames: many(s.groupNicknames, { relationName: "nicknames_target" }),
    blocksPlaced: many(s.groupBlocks, { relationName: "blocks_blocker" }),
    blocksReceived: many(s.groupBlocks, { relationName: "blocks_blocked" }),
    kickVotes: many(s.kickVotes),
    splitVotes: many(s.splitVotes),
    mergeInitiated: many(s.mergeVotes, { relationName: "merge_initiated" }),
    mergeTargeted: many(s.mergeVotes, { relationName: "merge_targeted" }),
    sabbaticalVotes: many(s.sabbaticalVotes),
    directMessages: many(s.directMessages),
    pushTokens: many(s.pushTokens),
    shadowBans: many(s.shadowBans),
    activityEvents: many(s.activityEvents),
    retweets: many(s.retweets),
}));
// ── Users ──
export const usersRelations = relations(s.users, ({ many }) => ({
    memberships: many(s.memberships),
    createdImpulses: many(s.impulses, { relationName: "impulses_creator" }),
    votes: many(s.votes),
    drafts: many(s.drafts),
    createdInviteCodes: many(s.inviteCodes, { relationName: "invite_codes_creator" }),
    usedInviteCodes: many(s.inviteCodes, { relationName: "invite_codes_user" }),
    sentDMs: many(s.directMessages, { relationName: "dms_sender" }),
    receivedDMs: many(s.directMessages, { relationName: "dms_recipient" }),
    pushTokens: many(s.pushTokens),
    notifications: many(s.notifications),
    shadowBans: many(s.shadowBans),
    shadowBannedBy: many(s.shadowBans, { relationName: "shadow_bans_banner" }),
    shadowBansLifted: many(s.shadowBans, { relationName: "shadow_bans_lifter" }),
    messageReports: many(s.messageReports, { relationName: "reports_reporter" }),
    messageReportsReviewed: many(s.messageReports, { relationName: "reports_reviewer" }),
    fraudAudit: many(s.fraudAuditLog, { relationName: "fraud_user" }),
    fraudAuditCreatedBy: many(s.fraudAuditLog, { relationName: "fraud_creator" }),
}));
// ── Memberships ──
export const membershipsRelations = relations(s.memberships, ({ one }) => ({
    user: one(s.users, {
        fields: [s.memberships.userId],
        references: [s.users.id],
    }),
    group: one(s.groups, {
        fields: [s.memberships.groupId],
        references: [s.groups.id],
    }),
}));
// ── Impulses ──
export const impulsesRelations = relations(s.impulses, ({ one, many }) => ({
    group: one(s.groups, {
        fields: [s.impulses.groupId],
        references: [s.groups.id],
        relationName: "impulses_group",
    }),
    targetGroup: one(s.groups, {
        fields: [s.impulses.targetGroupId],
        references: [s.groups.id],
        relationName: "impulses_target_group",
    }),
    creator: one(s.users, {
        fields: [s.impulses.createdBy],
        references: [s.users.id],
        relationName: "impulses_creator",
    }),
    votes: many(s.votes),
    drafts: many(s.drafts),
    summaryCandidates: many(s.summaryCandidates),
    messages: many(s.messages),
}));
// ── Votes ──
export const votesRelations = relations(s.votes, ({ one }) => ({
    impulse: one(s.impulses, {
        fields: [s.votes.impulseId],
        references: [s.impulses.id],
    }),
    user: one(s.users, {
        fields: [s.votes.userId],
        references: [s.users.id],
    }),
}));
// ── Drafts ──
export const draftsRelations = relations(s.drafts, ({ one }) => ({
    impulse: one(s.impulses, {
        fields: [s.drafts.impulseId],
        references: [s.impulses.id],
    }),
    user: one(s.users, {
        fields: [s.drafts.userId],
        references: [s.users.id],
    }),
}));
// ── Summary Candidates ──
export const summaryCandidatesRelations = relations(s.summaryCandidates, ({ one }) => ({
    impulse: one(s.impulses, {
        fields: [s.summaryCandidates.impulseId],
        references: [s.impulses.id],
    }),
}));
// ── Messages ──
export const messagesRelations = relations(s.messages, ({ one, many }) => ({
    impulse: one(s.impulses, {
        fields: [s.messages.impulseId],
        references: [s.impulses.id],
    }),
    group: one(s.groups, {
        fields: [s.messages.groupId],
        references: [s.groups.id],
        relationName: "messages_group",
    }),
    targetGroup: one(s.groups, {
        fields: [s.messages.targetGroupId],
        references: [s.groups.id],
        relationName: "messages_target_group",
    }),
    retweets: many(s.retweets),
}));
// ── Retweets ──
export const retweetsRelations = relations(s.retweets, ({ one }) => ({
    message: one(s.messages, {
        fields: [s.retweets.messageId],
        references: [s.messages.id],
    }),
    group: one(s.groups, {
        fields: [s.retweets.groupId],
        references: [s.groups.id],
    }),
}));
// ── Invite Codes ──
export const inviteCodesRelations = relations(s.inviteCodes, ({ one }) => ({
    group: one(s.groups, {
        fields: [s.inviteCodes.groupId],
        references: [s.groups.id],
    }),
    createdByUser: one(s.users, {
        fields: [s.inviteCodes.createdBy],
        references: [s.users.id],
        relationName: "invite_codes_creator",
    }),
    usedByUser: one(s.users, {
        fields: [s.inviteCodes.usedBy],
        references: [s.users.id],
        relationName: "invite_codes_user",
    }),
}));
// ── Group Nicknames ──
export const groupNicknamesRelations = relations(s.groupNicknames, ({ one }) => ({
    sourceGroup: one(s.groups, {
        fields: [s.groupNicknames.sourceGroupId],
        references: [s.groups.id],
        relationName: "nicknames_source",
    }),
    targetGroup: one(s.groups, {
        fields: [s.groupNicknames.targetGroupId],
        references: [s.groups.id],
        relationName: "nicknames_target",
    }),
}));
// ── Group Blocks ──
export const groupBlocksRelations = relations(s.groupBlocks, ({ one }) => ({
    blockerGroup: one(s.groups, {
        fields: [s.groupBlocks.blockerGroupId],
        references: [s.groups.id],
        relationName: "blocks_blocker",
    }),
    blockedGroup: one(s.groups, {
        fields: [s.groupBlocks.blockedGroupId],
        references: [s.groups.id],
        relationName: "blocks_blocked",
    }),
}));
// ── Kick Votes ──
export const kickVotesRelations = relations(s.kickVotes, ({ one, many }) => ({
    group: one(s.groups, {
        fields: [s.kickVotes.groupId],
        references: [s.groups.id],
    }),
    targetUser: one(s.users, {
        fields: [s.kickVotes.targetUserId],
        references: [s.users.id],
    }),
    initiatedByUser: one(s.users, {
        fields: [s.kickVotes.initiatedBy],
        references: [s.users.id],
    }),
    records: many(s.kickVoteRecords),
}));
export const kickVoteRecordsRelations = relations(s.kickVoteRecords, ({ one }) => ({
    kickVote: one(s.kickVotes, {
        fields: [s.kickVoteRecords.kickVoteId],
        references: [s.kickVotes.id],
    }),
    user: one(s.users, {
        fields: [s.kickVoteRecords.userId],
        references: [s.users.id],
    }),
}));
// ── Split Votes ──
export const splitVotesRelations = relations(s.splitVotes, ({ one, many }) => ({
    group: one(s.groups, {
        fields: [s.splitVotes.groupId],
        references: [s.groups.id],
    }),
    initiatedByUser: one(s.users, {
        fields: [s.splitVotes.initiatedBy],
        references: [s.users.id],
    }),
    selections: many(s.splitSelections),
}));
export const splitSelectionsRelations = relations(s.splitSelections, ({ one }) => ({
    splitVote: one(s.splitVotes, {
        fields: [s.splitSelections.splitVoteId],
        references: [s.splitVotes.id],
    }),
    user: one(s.users, {
        fields: [s.splitSelections.userId],
        references: [s.users.id],
    }),
}));
// ── Merge Votes ──
export const mergeVotesRelations = relations(s.mergeVotes, ({ one, many }) => ({
    initiatedByGroup: one(s.groups, {
        fields: [s.mergeVotes.initiatedByGroupId],
        references: [s.groups.id],
        relationName: "merge_initiated",
    }),
    targetGroup: one(s.groups, {
        fields: [s.mergeVotes.targetGroupId],
        references: [s.groups.id],
        relationName: "merge_targeted",
    }),
    initiatedByUser: one(s.users, {
        fields: [s.mergeVotes.initiatedBy],
        references: [s.users.id],
    }),
    approvals: many(s.mergeApprovals),
}));
export const mergeApprovalsRelations = relations(s.mergeApprovals, ({ one }) => ({
    mergeVote: one(s.mergeVotes, {
        fields: [s.mergeApprovals.mergeVoteId],
        references: [s.mergeVotes.id],
    }),
    user: one(s.users, {
        fields: [s.mergeApprovals.userId],
        references: [s.users.id],
    }),
    group: one(s.groups, {
        fields: [s.mergeApprovals.groupId],
        references: [s.groups.id],
    }),
}));
// ── Sabbatical Votes ──
export const sabbaticalVotesRelations = relations(s.sabbaticalVotes, ({ one, many }) => ({
    group: one(s.groups, {
        fields: [s.sabbaticalVotes.groupId],
        references: [s.groups.id],
    }),
    initiatedByUser: one(s.users, {
        fields: [s.sabbaticalVotes.initiatedBy],
        references: [s.users.id],
    }),
    records: many(s.sabbaticalVoteRecords),
}));
export const sabbaticalVoteRecordsRelations = relations(s.sabbaticalVoteRecords, ({ one }) => ({
    sabbaticalVote: one(s.sabbaticalVotes, {
        fields: [s.sabbaticalVoteRecords.sabbaticalVoteId],
        references: [s.sabbaticalVotes.id],
    }),
    user: one(s.users, {
        fields: [s.sabbaticalVoteRecords.userId],
        references: [s.users.id],
    }),
}));
// ── Direct Messages ──
export const directMessagesRelations = relations(s.directMessages, ({ one }) => ({
    group: one(s.groups, {
        fields: [s.directMessages.groupId],
        references: [s.groups.id],
    }),
    sender: one(s.users, {
        fields: [s.directMessages.senderId],
        references: [s.users.id],
        relationName: "dms_sender",
    }),
    recipient: one(s.users, {
        fields: [s.directMessages.recipientId],
        references: [s.users.id],
        relationName: "dms_recipient",
    }),
}));
// ── Banned Words ──
export const bannedWordsRelations = relations(s.bannedWords, ({ one }) => ({
    addedByUser: one(s.users, {
        fields: [s.bannedWords.addedBy],
        references: [s.users.id],
    }),
}));
// ── Message Reports ──
export const messageReportsRelations = relations(s.messageReports, ({ one }) => ({
    message: one(s.messages, {
        fields: [s.messageReports.messageId],
        references: [s.messages.id],
    }),
    reportedByUser: one(s.users, {
        fields: [s.messageReports.reportedBy],
        references: [s.users.id],
        relationName: "reports_reporter",
    }),
    reviewedByUser: one(s.users, {
        fields: [s.messageReports.reviewedBy],
        references: [s.users.id],
        relationName: "reports_reviewer",
    }),
}));
// ── Shadow Bans ──
export const shadowBansRelations = relations(s.shadowBans, ({ one }) => ({
    user: one(s.users, {
        fields: [s.shadowBans.userId],
        references: [s.users.id],
    }),
    group: one(s.groups, {
        fields: [s.shadowBans.groupId],
        references: [s.groups.id],
    }),
    bannedBy: one(s.users, {
        fields: [s.shadowBans.shadowBannedBy],
        references: [s.users.id],
        relationName: "shadow_bans_banner",
    }),
    liftedByUser: one(s.users, {
        fields: [s.shadowBans.liftedBy],
        references: [s.users.id],
        relationName: "shadow_bans_lifter",
    }),
}));
// ── Fraud Audit Log ──
export const fraudAuditLogRelations = relations(s.fraudAuditLog, ({ one }) => ({
    user: one(s.users, {
        fields: [s.fraudAuditLog.userId],
        references: [s.users.id],
        relationName: "fraud_user",
    }),
    group: one(s.groups, {
        fields: [s.fraudAuditLog.groupId],
        references: [s.groups.id],
    }),
    createdByUser: one(s.users, {
        fields: [s.fraudAuditLog.createdBy],
        references: [s.users.id],
        relationName: "fraud_creator",
    }),
}));
// ── Push Tokens ──
export const pushTokensRelations = relations(s.pushTokens, ({ one }) => ({
    user: one(s.users, {
        fields: [s.pushTokens.userId],
        references: [s.users.id],
    }),
}));
// ── Notifications ──
export const notificationsRelations = relations(s.notifications, ({ one }) => ({
    user: one(s.users, {
        fields: [s.notifications.userId],
        references: [s.users.id],
    }),
}));
// ── Activity Events ──
export const activityEventsRelations = relations(s.activityEvents, ({ one }) => ({
    user: one(s.users, {
        fields: [s.activityEvents.userId],
        references: [s.users.id],
    }),
    group: one(s.groups, {
        fields: [s.activityEvents.groupId],
        references: [s.groups.id],
    }),
}));
//# sourceMappingURL=relations.js.map