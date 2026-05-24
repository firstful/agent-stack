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
export type GroupTier = z.infer<typeof GroupTier>;

export const TIER_THRESHOLDS: Record<GroupTier, number> = {
  fringe: 0,
  small: 5,
  medium: 50,
  large: 200,
  huge: 1000,
  massive: 10000,
};

export function tierForMemberCount(count: number): GroupTier {
  if (count >= 10000) return "massive";
  if (count >= 1000) return "huge";
  if (count >= 200) return "large";
  if (count >= 50) return "medium";
  if (count >= 5) return "small";
  return "fringe";
}

// ── Energy ──
export const GroupEnergy = z.enum([
  "thoughtful",
  "snarky",
  "funny",
  "mixed",
]);
export type GroupEnergy = z.infer<typeof GroupEnergy>;

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
export type ImpulseStatus = z.infer<typeof ImpulseStatus>;

// ── Vote ──
export const VoteType = z.enum(["yes", "no", "abstain"]);
export type VoteType = z.infer<typeof VoteType>;

// ── Groups ──
export const CreateGroupInput = z.object({
  name: z.string().min(1).max(100),
  bio: z.string().max(500).default(""),
  energy: GroupEnergy.default("thoughtful"),
  timezone: z.string().optional(),
});
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

export const JoinGroupInput = z.object({
  code: z.string().min(1),
});
export type JoinGroupInput = z.infer<typeof JoinGroupInput>;

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
export type InviteCodeSchema = z.infer<typeof InviteCodeSchema>;

// ── Messages ──
export const MessageStatus = z.enum(["active", "revoked"]);
export type MessageStatus = z.infer<typeof MessageStatus>;

// ── API types ──
export const CreateImpulseInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  targetGroupId: z.string().uuid().optional(),
  targetPostId: z.string().uuid().optional(),
});
export type CreateImpulseInput = z.infer<typeof CreateImpulseInput>;

export const CastVoteInput = z.object({
  impulseId: z.string().uuid(),
  vote: VoteType,
});
export type CastVoteInput = z.infer<typeof CastVoteInput>;

export const SendDraftInput = z.object({
  impulseId: z.string().uuid(),
  content: z.string().max(5000),
});
export type SendDraftInput = z.infer<typeof SendDraftInput>;

export const AuthRegisterInput = z.object({
  provider: z.enum(["google", "github", "apple"]),
  providerId: z.string().min(1),
  username: z.string().min(2).max(30),
});
export type AuthRegisterInput = z.infer<typeof AuthRegisterInput>;

export { canTransition, assertTransition } from "./lib/state-machine";
export type { Transition } from "./lib/state-machine";
export {
  adaptiveRemaining,
  composingRemaining,
  MAX_VOTING_WINDOW,
  MIN_VOTING_WINDOW,
  SUPERMAJORITY_RATIO,
  MAX_COMPOSING_WINDOW,
  MIN_COMPOSING_WINDOW,
} from "./lib/adaptive-timer";
export {
  tenureWeight,
  reputationDecay,
  effectiveWeight,
  REPUTATION_HALF_LIFE_DAYS,
} from "./lib/tenure";
export { sortQueue, assignQueuePositions } from "./lib/queue";
export type { QueuedImpulse } from "./lib/queue";
export { buildLLMPrompts, parseLLMResponse } from "./lib/llm-prompt";
export type { LLMInput, LLMPrompts } from "./lib/llm-prompt";
