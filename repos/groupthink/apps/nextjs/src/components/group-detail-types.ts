// ── Group Detail Types ──

export type Group = {
  id: string;
  name: string;
  bio: string;
  energy: string;
  timezone: string | null;
  tier: string;
  memberCount: number;
  minInteractionTier?: string;
  sabbaticalUntil?: string | null;
  lastEnergyChangeAt?: string;
};

export type Member = {
  id: string;
  userId: string;
  joinedAt: string;
  isVouched: boolean;
  user: { id: string; username: string; createdAt: string };
};

export type Impulse = {
  id: string;
  groupId: string;
  targetGroupId: string | null;
  targetPostId: string | null;
  title: string;
  description: string;
  createdBy: string;
  status: string;
  queuePosition: number | null;
  votingEndsAt: string | null;
  createdAt: string;
};

export type TallyCohort = {
  range: string;
  minDays: number;
  maxDays: number;
  yesWeight: number;
  noWeight: number;
  voterCount: number;
};

export type Tally = {
  cohorts: TallyCohort[];
  totals: { yesWeight: number; noWeight: number; totalVoters: number };
};

export type GroupBlock = {
  id: string;
  blockerGroupId: string;
  blockedGroupId: string;
  createdAt: string;
  blockedGroup: { id: string; name: string; energy: string };
};

export type KickVote = {
  id: string;
  groupId: string;
  targetUserId: string;
  initiatedBy: string;
  reason: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  targetUser?: { id: string; username: string };
  initiatedByUser?: { id: string; username: string };
  records?: { id: string; userId: string; vote: string; weight: number; user: { id: string; username: string } }[];
  tally?: { yesWeight: number; noWeight: number; totalWeight: number };
};

export type SplitVote = {
  id: string;
  groupId: string;
  initiatedBy: string;
  newGroupName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  memberCount?: number;
  selectionsCount?: number;
  stayingCount?: number;
  splinteringCount?: number;
  selections?: { id: string; userId: string; chooseOriginal: boolean; user: { id: string; username: string } }[];
};

export type MergeVote = {
  id: string;
  initiatedByGroupId: string;
  targetGroupId: string;
  initiatedBy: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  initiatedByGroup?: { id: string; name: string };
  targetGroup?: { id: string; name: string };
  initiatorApprovals?: { id: string; userId: string; approved: boolean; user: { id: string; username: string } }[];
  targetApprovals?: { id: string; userId: string; approved: boolean; user: { id: string; username: string } }[];
};

export type SabbaticalVote = {
  id: string;
  groupId: string;
  initiatedBy: string;
  direction: string;
  durationHours: number;
  status: string;
  createdAt: string;
  expiresAt: string;
  records?: { id: string; userId: string; vote: string; weight: number; user: { id: string; username: string } }[];
  tally?: { yesWeight: number; noWeight: number; totalWeight: number };
};

// ── Constants ──

export const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  voting: "Voting",
  composing: "Drafting",
  summarizing: "Summarizing",
  approval: "Approval",
  broadcast: "✓ Broadcast",
  expired: "✗ Expired",
  discarded: "— Discarded",
};

export const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-muted)",
  voting: "var(--accent)",
  composing: "var(--warning)",
  summarizing: "var(--energy-snarky)",
  approval: "var(--energy-thoughtful)",
  broadcast: "var(--success)",
  expired: "var(--danger)",
  discarded: "var(--text-muted)",
};

export const TIER_ORDER = ["fringe", "small", "medium", "large", "huge", "massive"];

export const ENERGY_OPTIONS = [
  { value: "thoughtful", label: "Thoughtful 💭", icon: "💭" },
  { value: "snarky", label: "Snarky 🔥", icon: "🔥" },
  { value: "funny", label: "Funny 🎭", icon: "🎭" },
  { value: "mixed", label: "Mixed 🌈", icon: "🌈" },
] as const;

export const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Pacific/Auckland",
];

// ── Utility functions ──

export function tenureDays(joinedAt: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(joinedAt).getTime()) / 86400000));
}

export function tenureDaysFromCreation(createdAt: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}

export function tenureLabel(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

export function tenureBarWidth(days: number): number {
  return Math.min(100, (days / 730) * 100);
}

export function tenureCohort(days: number): { color: string; label: string } {
  if (days >= 365) return { color: "#d2a8ff", label: "Veteran" };
  if (days >= 90) return { color: "#58a6ff", label: "Regular" };
  if (days >= 30) return { color: "#3fb950", label: "Growing" };
  return { color: "#8b949e", label: "New" };
}

export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Ending now";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
