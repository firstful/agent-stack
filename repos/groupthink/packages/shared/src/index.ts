import { z } from "zod";
import {
  sanitizeText,
  sanitizeAndTruncate,
  sanitizeRichAndTruncate,
  MAX_LENGTHS,
} from "./lib/sanitize";

/**
 * Helper: Zod transform that sanitizes a plain-text string field.
 * Strips all HTML, normalises whitespace, then truncates to the given max.
 */
export const sText = (max: number) =>
  z.string().transform((v) => sanitizeAndTruncate(v, max));

/**
 * Helper: Zod transform that sanitizes a rich-text string field.
 * Strips script tags/event handlers, trims, then truncates to the given max.
 */
export const sRich = (max: number) =>
  z.string().transform((v) => sanitizeRichAndTruncate(v, max));

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
  name: sText(100).pipe(z.string().min(1)),
  bio: sRich(500).default(""),
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
  title: sText(200).pipe(z.string().min(1)),
  description: sRich(2000).default(""),
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
  content: sRich(5000).pipe(z.string().min(1)),
});
export type SendDraftInput = z.infer<typeof SendDraftInput>;

export const AuthRegisterInput = z.object({
  provider: z.enum(["google", "github", "apple"]),
  providerId: z.string().min(1),
  username: sText(30).pipe(z.string().min(2)),
});
export type AuthRegisterInput = z.infer<typeof AuthRegisterInput>;

// ── Direct Messages ──
export const SendDMInput = z.object({
  groupId: z.string().uuid(),
  recipientId: z.string().uuid(),
  content: sRich(5000).pipe(z.string().min(1)),
});
export type SendDMInput = z.infer<typeof SendDMInput>;

export {
  engagementPoints,
  activityGateMultiplier,
  activityGateBreakdown,
  ACTIVITY_WINDOW_DAYS,
  ENGAGEMENT_POINTS_FOR_MAX,
  MAX_BOOST,
} from "./lib/activity-gate";
export type { EngagementEvent } from "./lib/activity-gate";

export {
  vouchMultiplier,
  combinedVoteWeight,
  VOUCH_BOOST,
} from "./lib/activity-gate";

export {
  sanitizeText,
  sanitizeRichText,
  sanitizeAndTruncate,
  sanitizeRichAndTruncate,
  sanitizeObject,
  stripScriptTags,
  stripAllHtml,
  normalizeWhitespace,
  truncate,
  MAX_LENGTHS,
} from "./lib/sanitize";
export type { StringFields } from "./lib/sanitize";

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

export {
  suppressionFactor,
  applyVoteSuppression,
  SUPPRESSED_VOTE_RATIO,
} from "./lib/vote-suppression";
