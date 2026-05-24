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
export declare const MessageStatus: z.ZodEnum<["active", "revoked"]>;
export type MessageStatus = z.infer<typeof MessageStatus>;
export declare const CreateImpulseInput: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
    targetGroupId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    targetGroupId: string;
    title: string;
    description: string;
}, {
    targetGroupId: string;
    title: string;
    description: string;
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
//# sourceMappingURL=index.d.ts.map