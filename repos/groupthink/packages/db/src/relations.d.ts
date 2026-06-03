export declare const groupsRelations: import("drizzle-orm").Relations<"groups", {
    memberships: import("drizzle-orm").Many<"memberships">;
    impulsesFrom: import("drizzle-orm").Many<"impulses">;
    impulsesTargeted: import("drizzle-orm").Many<"impulses">;
    messagesFrom: import("drizzle-orm").Many<"messages">;
    messagesTargeted: import("drizzle-orm").Many<"messages">;
    inviteCodes: import("drizzle-orm").Many<"invite_codes">;
    sourceNicknames: import("drizzle-orm").Many<"group_nicknames">;
    targetNicknames: import("drizzle-orm").Many<"group_nicknames">;
    blocksPlaced: import("drizzle-orm").Many<"group_blocks">;
    blocksReceived: import("drizzle-orm").Many<"group_blocks">;
    kickVotes: import("drizzle-orm").Many<"kick_votes">;
    splitVotes: import("drizzle-orm").Many<"split_votes">;
    mergeInitiated: import("drizzle-orm").Many<"merge_votes">;
    mergeTargeted: import("drizzle-orm").Many<"merge_votes">;
    sabbaticalVotes: import("drizzle-orm").Many<"sabbatical_votes">;
    directMessages: import("drizzle-orm").Many<"direct_messages">;
    pushTokens: import("drizzle-orm").Many<"push_tokens">;
    shadowBans: import("drizzle-orm").Many<"shadow_bans">;
    activityEvents: import("drizzle-orm").Many<"activity_events">;
    retweets: import("drizzle-orm").Many<"retweets">;
}>;
export declare const usersRelations: import("drizzle-orm").Relations<"users", {
    memberships: import("drizzle-orm").Many<"memberships">;
    createdImpulses: import("drizzle-orm").Many<"impulses">;
    votes: import("drizzle-orm").Many<"votes">;
    drafts: import("drizzle-orm").Many<"drafts">;
    createdInviteCodes: import("drizzle-orm").Many<"invite_codes">;
    usedInviteCodes: import("drizzle-orm").Many<"invite_codes">;
    sentDMs: import("drizzle-orm").Many<"direct_messages">;
    receivedDMs: import("drizzle-orm").Many<"direct_messages">;
    pushTokens: import("drizzle-orm").Many<"push_tokens">;
    notifications: import("drizzle-orm").Many<"notifications">;
    shadowBans: import("drizzle-orm").Many<"shadow_bans">;
    shadowBannedBy: import("drizzle-orm").Many<"shadow_bans">;
    shadowBansLifted: import("drizzle-orm").Many<"shadow_bans">;
    messageReports: import("drizzle-orm").Many<"message_reports">;
    messageReportsReviewed: import("drizzle-orm").Many<"message_reports">;
    fraudAudit: import("drizzle-orm").Many<"fraud_audit_log">;
    fraudAuditCreatedBy: import("drizzle-orm").Many<"fraud_audit_log">;
}>;
export declare const membershipsRelations: import("drizzle-orm").Relations<"memberships", {
    user: import("drizzle-orm").One<"users", true>;
    group: import("drizzle-orm").One<"groups", true>;
}>;
export declare const impulsesRelations: import("drizzle-orm").Relations<"impulses", {
    group: import("drizzle-orm").One<"groups", true>;
    targetGroup: import("drizzle-orm").One<"groups", false>;
    creator: import("drizzle-orm").One<"users", true>;
    votes: import("drizzle-orm").Many<"votes">;
    drafts: import("drizzle-orm").Many<"drafts">;
    summaryCandidates: import("drizzle-orm").Many<"summary_candidates">;
    messages: import("drizzle-orm").Many<"messages">;
}>;
export declare const votesRelations: import("drizzle-orm").Relations<"votes", {
    impulse: import("drizzle-orm").One<"impulses", true>;
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const draftsRelations: import("drizzle-orm").Relations<"drafts", {
    impulse: import("drizzle-orm").One<"impulses", true>;
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const summaryCandidatesRelations: import("drizzle-orm").Relations<"summary_candidates", {
    impulse: import("drizzle-orm").One<"impulses", true>;
}>;
export declare const messagesRelations: import("drizzle-orm").Relations<"messages", {
    impulse: import("drizzle-orm").One<"impulses", true>;
    group: import("drizzle-orm").One<"groups", true>;
    targetGroup: import("drizzle-orm").One<"groups", false>;
    retweets: import("drizzle-orm").Many<"retweets">;
}>;
export declare const retweetsRelations: import("drizzle-orm").Relations<"retweets", {
    message: import("drizzle-orm").One<"messages", true>;
    group: import("drizzle-orm").One<"groups", true>;
}>;
export declare const inviteCodesRelations: import("drizzle-orm").Relations<"invite_codes", {
    group: import("drizzle-orm").One<"groups", true>;
    createdByUser: import("drizzle-orm").One<"users", true>;
    usedByUser: import("drizzle-orm").One<"users", false>;
}>;
export declare const groupNicknamesRelations: import("drizzle-orm").Relations<"group_nicknames", {
    sourceGroup: import("drizzle-orm").One<"groups", true>;
    targetGroup: import("drizzle-orm").One<"groups", true>;
}>;
export declare const groupBlocksRelations: import("drizzle-orm").Relations<"group_blocks", {
    blockerGroup: import("drizzle-orm").One<"groups", true>;
    blockedGroup: import("drizzle-orm").One<"groups", true>;
}>;
export declare const kickVotesRelations: import("drizzle-orm").Relations<"kick_votes", {
    group: import("drizzle-orm").One<"groups", true>;
    targetUser: import("drizzle-orm").One<"users", true>;
    initiatedByUser: import("drizzle-orm").One<"users", true>;
    records: import("drizzle-orm").Many<"kick_vote_records">;
}>;
export declare const kickVoteRecordsRelations: import("drizzle-orm").Relations<"kick_vote_records", {
    kickVote: import("drizzle-orm").One<"kick_votes", true>;
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const splitVotesRelations: import("drizzle-orm").Relations<"split_votes", {
    group: import("drizzle-orm").One<"groups", true>;
    initiatedByUser: import("drizzle-orm").One<"users", true>;
    selections: import("drizzle-orm").Many<"split_selections">;
}>;
export declare const splitSelectionsRelations: import("drizzle-orm").Relations<"split_selections", {
    splitVote: import("drizzle-orm").One<"split_votes", true>;
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const mergeVotesRelations: import("drizzle-orm").Relations<"merge_votes", {
    initiatedByGroup: import("drizzle-orm").One<"groups", true>;
    targetGroup: import("drizzle-orm").One<"groups", true>;
    initiatedByUser: import("drizzle-orm").One<"users", true>;
    approvals: import("drizzle-orm").Many<"merge_approvals">;
}>;
export declare const mergeApprovalsRelations: import("drizzle-orm").Relations<"merge_approvals", {
    mergeVote: import("drizzle-orm").One<"merge_votes", true>;
    user: import("drizzle-orm").One<"users", true>;
    group: import("drizzle-orm").One<"groups", true>;
}>;
export declare const sabbaticalVotesRelations: import("drizzle-orm").Relations<"sabbatical_votes", {
    group: import("drizzle-orm").One<"groups", true>;
    initiatedByUser: import("drizzle-orm").One<"users", true>;
    records: import("drizzle-orm").Many<"sabbatical_vote_records">;
}>;
export declare const sabbaticalVoteRecordsRelations: import("drizzle-orm").Relations<"sabbatical_vote_records", {
    sabbaticalVote: import("drizzle-orm").One<"sabbatical_votes", true>;
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const directMessagesRelations: import("drizzle-orm").Relations<"direct_messages", {
    group: import("drizzle-orm").One<"groups", true>;
    sender: import("drizzle-orm").One<"users", true>;
    recipient: import("drizzle-orm").One<"users", true>;
}>;
export declare const bannedWordsRelations: import("drizzle-orm").Relations<"banned_words", {
    addedByUser: import("drizzle-orm").One<"users", true>;
}>;
export declare const messageReportsRelations: import("drizzle-orm").Relations<"message_reports", {
    message: import("drizzle-orm").One<"messages", true>;
    reportedByUser: import("drizzle-orm").One<"users", true>;
    reviewedByUser: import("drizzle-orm").One<"users", false>;
}>;
export declare const shadowBansRelations: import("drizzle-orm").Relations<"shadow_bans", {
    user: import("drizzle-orm").One<"users", true>;
    group: import("drizzle-orm").One<"groups", false>;
    bannedBy: import("drizzle-orm").One<"users", false>;
    liftedByUser: import("drizzle-orm").One<"users", false>;
}>;
export declare const fraudAuditLogRelations: import("drizzle-orm").Relations<"fraud_audit_log", {
    user: import("drizzle-orm").One<"users", false>;
    group: import("drizzle-orm").One<"groups", false>;
    createdByUser: import("drizzle-orm").One<"users", false>;
}>;
export declare const pushTokensRelations: import("drizzle-orm").Relations<"push_tokens", {
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const notificationsRelations: import("drizzle-orm").Relations<"notifications", {
    user: import("drizzle-orm").One<"users", true>;
}>;
export declare const activityEventsRelations: import("drizzle-orm").Relations<"activity_events", {
    user: import("drizzle-orm").One<"users", true>;
    group: import("drizzle-orm").One<"groups", true>;
}>;
//# sourceMappingURL=relations.d.ts.map