import { z } from "zod";
// ── Group tiers ──
export const GroupTier = z.enum([
    "fringe",
    "small",
    "medium",
    "large",
    "huge",
    "massive",
]);
export const TIER_THRESHOLDS = {
    fringe: 0,
    small: 5,
    medium: 50,
    large: 200,
    huge: 1000,
    massive: 10000,
};
export function tierForMemberCount(count) {
    if (count >= 10000)
        return "massive";
    if (count >= 1000)
        return "huge";
    if (count >= 200)
        return "large";
    if (count >= 50)
        return "medium";
    if (count >= 5)
        return "small";
    return "fringe";
}
// ── Energy ──
export const GroupEnergy = z.enum([
    "thoughtful",
    "snarky",
    "funny",
    "mixed",
]);
// ── Impulse ──
export const ImpulseStatus = z.enum([
    "queued",
    "voting",
    "composing",
    "summarizing",
    "approval",
    "broadcast",
    "expired",
    "discarded",
]);
// ── Vote ──
export const VoteType = z.enum(["yes", "no", "abstain"]);
// ── Groups ──
export const CreateGroupInput = z.object({
    name: z.string().min(1).max(100),
    bio: z.string().max(500).default(""),
    energy: GroupEnergy.default("thoughtful"),
    timezone: z.string().optional(),
});
export const JoinGroupInput = z.object({
    code: z.string().min(1),
});
export const InviteCodeSchema = z.object({
    id: z.string().uuid(),
    code: z.string(),
    groupId: z.string().uuid(),
    createdBy: z.string().uuid(),
    usedBy: z.string().uuid().nullable(),
    usedAt: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
});
// ── Messages ──
export const MessageStatus = z.enum(["active", "revoked"]);
// ── API types ──
export const CreateImpulseInput = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).default(""),
    targetGroupId: z.string().uuid().optional(),
    targetPostId: z.string().uuid().optional(),
});
export const CastVoteInput = z.object({
    impulseId: z.string().uuid(),
    vote: VoteType,
});
export const SendDraftInput = z.object({
    impulseId: z.string().uuid(),
    content: z.string().max(5000),
});
export const AuthRegisterInput = z.object({
    provider: z.enum(["google", "github", "apple"]),
    providerId: z.string().min(1),
    username: z.string().min(2).max(30),
});
// ── Direct Messages ──
export const SendDMInput = z.object({
    groupId: z.string().uuid(),
    recipientId: z.string().uuid(),
    content: z.string().min(1).max(5000),
});
export { engagementPoints, activityGateMultiplier, activityGateBreakdown, ACTIVITY_WINDOW_DAYS, ENGAGEMENT_POINTS_FOR_MAX, MAX_BOOST, } from "./lib/activity-gate";
export { vouchMultiplier, combinedVoteWeight, VOUCH_BOOST, } from "./lib/activity-gate";
export { sanitizeText, sanitizeRichText, sanitizeAndTruncate, sanitizeRichAndTruncate, sanitizeObject, stripScriptTags, stripAllHtml, normalizeWhitespace, truncate, MAX_LENGTHS, } from "./lib/sanitize";
export { canTransition, assertTransition } from "./lib/state-machine";
export { adaptiveRemaining, composingRemaining, MAX_VOTING_WINDOW, MIN_VOTING_WINDOW, SUPERMAJORITY_RATIO, MAX_COMPOSING_WINDOW, MIN_COMPOSING_WINDOW, } from "./lib/adaptive-timer";
export { tenureWeight, reputationDecay, effectiveWeight, REPUTATION_HALF_LIFE_DAYS, } from "./lib/tenure";
export { sortQueue, assignQueuePositions } from "./lib/queue";
export { buildLLMPrompts, parseLLMResponse } from "./lib/llm-prompt";
export { suppressionFactor, applyVoteSuppression, SUPPRESSED_VOTE_RATIO, } from "./lib/vote-suppression";
//# sourceMappingURL=index.js.map