/**
 * Vote Suppression — reduce or zero voting weight for flagged accounts.
 *
 * Two sources of suppression:
 *   1. Shadow ban (explicit admin action) — weight reduced to zero
 *   2. Fraud flag (automated detection) — weight reduced by a configurable ratio
 *
 * The suppression factor is a multiplier applied to the base vote weight:
 *   - Clean account: 1.0 (no suppression)
 *   - Fraud-flagged: SUPPRESSED_VOTE_RATIO (default 0.5)
 *   - Shadow-banned: 0.0 (complete suppression)
 *
 * When both apply, the stricter (shadow ban) wins.
 */

export const SUPPRESSED_VOTE_RATIO = 0.5; // 50% weight for fraud-flagged accounts

/**
 * Compute the vote weight suppression factor for a user.
 *
 * @param isShadowBanned - Whether the user has an active shadow ban.
 * @param isFraudFlagged - Whether the user has an active fraud flag.
 * @returns A multiplier: 0.0 (full suppression), 0.5 (fraud-flagged), or 1.0 (clean).
 */
export function suppressionFactor(
  isShadowBanned: boolean,
  isFraudFlagged: boolean,
): number {
  if (isShadowBanned) return 0;
  if (isFraudFlagged) return SUPPRESSED_VOTE_RATIO;
  return 1.0;
}

/**
 * Apply suppression to a base vote weight.
 *
 * @param baseWeight - The raw vote weight (e.g., from tenureWeight).
 * @param isShadowBanned - Whether the user has an active shadow ban.
 * @param isFraudFlagged - Whether the user has an active fraud flag.
 * @returns The suppressed weight, floored at 0.
 */
export function applyVoteSuppression(
  baseWeight: number,
  isShadowBanned: boolean,
  isFraudFlagged: boolean,
): number {
  const factor = suppressionFactor(isShadowBanned, isFraudFlagged);
  return Math.max(0, Math.round(baseWeight * factor));
}
