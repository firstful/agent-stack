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
export declare const SUPPRESSED_VOTE_RATIO = 0.5;
/**
 * Compute the vote weight suppression factor for a user.
 *
 * @param isShadowBanned - Whether the user has an active shadow ban.
 * @param isFraudFlagged - Whether the user has an active fraud flag.
 * @returns A multiplier: 0.0 (full suppression), 0.5 (fraud-flagged), or 1.0 (clean).
 */
export declare function suppressionFactor(isShadowBanned: boolean, isFraudFlagged: boolean): number;
/**
 * Apply suppression to a base vote weight.
 *
 * @param baseWeight - The raw vote weight (e.g., from tenureWeight).
 * @param isShadowBanned - Whether the user has an active shadow ban.
 * @param isFraudFlagged - Whether the user has an active fraud flag.
 * @returns The suppressed weight, floored at 0.
 */
export declare function applyVoteSuppression(baseWeight: number, isShadowBanned: boolean, isFraudFlagged: boolean): number;
//# sourceMappingURL=vote-suppression.d.ts.map