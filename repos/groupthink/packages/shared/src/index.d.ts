import { z } from "zod";
export declare const GroupTier: z.ZodEnum<["fringe", "small", "medium", "large", "huge", "massive"]>;
export type GroupTier = z.infer<typeof GroupTier>;
export declare const TIER_THRESHOLDS: Record<GroupTier, number>;
export declare function tierForMemberCount(count: number): GroupTier;
export declare const GroupEnergy: z.ZodEnum<["thoughtful", "snarky", "funny", "mixed"]>;
export type GroupEnergy = z.infer<typeof GroupEnergy>;
export declare const ImpulseStatus: z.ZodEnum<["queued", "voting", "composing", "summarizing", "approval", "broadcast", "expired", "discarded"]>;
export type ImpulseStatus = z.infer<typeof ImpulseStatus>;
export declare const VoteType: z.ZodEnum<["yes", "no", "abstain"]>;
export type VoteType = z.infer<typeof VoteType>;
export declare const CreateGroupInput: z.ZodObject<{
    name: z.ZodString;
    bio: z.ZodDefault<z.ZodString>;
    energy: z.ZodDefault<z.ZodEnum<["thoughtful", "snarky", "funny", "mixed"]>>;
    timezone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    bio: string;
    energy: "thoughtful" | "snarky" | "funny" | "mixed";
    timezone?: string | undefined;
}, {
    name: string;
    bio?: string | undefined;
    energy?: "thoughtful" | "snarky" | "funny" | "mixed" | undefined;
    timezone?: string | undefined;
}>;
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;
export declare const JoinGroupInput: z.ZodObject<{
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
}, {
    code: string;
}>;
export type JoinGroupInput = z.infer<typeof JoinGroupInput>;
export declare const InviteCodeSchema: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodString;
    groupId: z.ZodString;
    createdBy: z.ZodString;
    usedBy: z.ZodNullable<z.ZodString>;
    usedAt: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    expiresAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    groupId: string;
    createdBy: string;
    code: string;
    usedBy: string | null;
    usedAt: string | null;
    expiresAt: string | null;
}, {
    id: string;
    createdAt: string;
    groupId: string;
    createdBy: string;
    code: string;
    usedBy: string | null;
    usedAt: string | null;
    expiresAt: string | null;
}>;
export type InviteCodeSchema = z.infer<typeof InviteCodeSchema>;
export declare const MessageStatus: z.ZodEnum<["active", "revoked"]>;
export type MessageStatus = z.infer<typeof MessageStatus>;
export declare const CreateImpulseInput: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    targetGroupId: z.ZodOptional<z.ZodString>;
    targetPostId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    description: string;
    targetGroupId?: string | undefined;
    targetPostId?: string | undefined;
}, {
    title: string;
    targetGroupId?: string | undefined;
    targetPostId?: string | undefined;
    description?: string | undefined;
}>;
export type CreateImpulseInput = z.infer<typeof CreateImpulseInput>;
export declare const CastVoteInput: z.ZodObject<{
    impulseId: z.ZodString;
    vote: z.ZodEnum<["yes", "no", "abstain"]>;
}, "strip", z.ZodTypeAny, {
    impulseId: string;
    vote: "yes" | "no" | "abstain";
}, {
    impulseId: string;
    vote: "yes" | "no" | "abstain";
}>;
export type CastVoteInput = z.infer<typeof CastVoteInput>;
export declare const SendDraftInput: z.ZodObject<{
    impulseId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    impulseId: string;
    content: string;
}, {
    impulseId: string;
    content: string;
}>;
export type SendDraftInput = z.infer<typeof SendDraftInput>;
export declare const AuthRegisterInput: z.ZodObject<{
    provider: z.ZodEnum<["google", "github", "apple"]>;
    providerId: z.ZodString;
    username: z.ZodString;
}, "strip", z.ZodTypeAny, {
    username: string;
    provider: "google" | "github" | "apple";
    providerId: string;
}, {
    username: string;
    provider: "google" | "github" | "apple";
    providerId: string;
}>;
export type AuthRegisterInput = z.infer<typeof AuthRegisterInput>;
export declare const SendDMInput: z.ZodObject<{
    groupId: z.ZodString;
    recipientId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    groupId: string;
    content: string;
    recipientId: string;
}, {
    groupId: string;
    content: string;
    recipientId: string;
}>;
export type SendDMInput = z.infer<typeof SendDMInput>;
export { engagementPoints, activityGateMultiplier, activityGateBreakdown, ACTIVITY_WINDOW_DAYS, ENGAGEMENT_POINTS_FOR_MAX, MAX_BOOST, } from "./lib/activity-gate";
export type { EngagementEvent } from "./lib/activity-gate";
export { vouchMultiplier, combinedVoteWeight, VOUCH_BOOST, } from "./lib/activity-gate";
export { sanitizeText, sanitizeRichText, sanitizeAndTruncate, sanitizeRichAndTruncate, sanitizeObject, stripScriptTags, stripAllHtml, normalizeWhitespace, truncate, MAX_LENGTHS, } from "./lib/sanitize";
export type { StringFields } from "./lib/sanitize";
export { canTransition, assertTransition } from "./lib/state-machine";
export type { Transition } from "./lib/state-machine";
export { adaptiveRemaining, composingRemaining, MAX_VOTING_WINDOW, MIN_VOTING_WINDOW, SUPERMAJORITY_RATIO, MAX_COMPOSING_WINDOW, MIN_COMPOSING_WINDOW, } from "./lib/adaptive-timer";
export { tenureWeight, reputationDecay, effectiveWeight, REPUTATION_HALF_LIFE_DAYS, } from "./lib/tenure";
export { sortQueue, assignQueuePositions } from "./lib/queue";
export type { QueuedImpulse } from "./lib/queue";
export { buildLLMPrompts, parseLLMResponse } from "./lib/llm-prompt";
export type { LLMInput, LLMPrompts } from "./lib/llm-prompt";
export { suppressionFactor, applyVoteSuppression, SUPPRESSED_VOTE_RATIO, } from "./lib/vote-suppression";
//# sourceMappingURL=index.d.ts.map