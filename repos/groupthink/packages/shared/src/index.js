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
// ── Messages ──
export const MessageStatus = z.enum(["active", "revoked"]);
// ── API types ──
export const CreateImpulseInput = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    targetGroupId: z.string().uuid(),
});
export const CastVoteInput = z.object({
    impulseId: z.string().uuid(),
    vote: VoteType,
});
export const SendDraftInput = z.object({
    impulseId: z.string().uuid(),
    content: z.string().max(5000),
});
//# sourceMappingURL=index.js.map