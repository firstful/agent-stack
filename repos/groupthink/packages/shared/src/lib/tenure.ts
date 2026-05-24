export function tenureWeight(joinedAt: Date, now: Date = new Date()): number {
  const days = Math.floor((now.getTime() - joinedAt.getTime()) / 86400000);
  return Math.max(1, days);
}

/** Decay multiplier based on days since last activity. */
export const REPUTATION_HALF_LIFE_DAYS = 60;

export function reputationDecay(lastActiveAt: Date, now: Date = new Date()): number {
  const daysSince = (now.getTime() - lastActiveAt.getTime()) / 86400000;
  if (daysSince <= 0) return 1;
  return Math.pow(0.5, daysSince / REPUTATION_HALF_LIFE_DAYS);
}

export function effectiveWeight(
  joinedAt: Date,
  lastActiveAt: Date,
  now?: Date
): number {
  return tenureWeight(joinedAt, now) * reputationDecay(lastActiveAt, now);
}
