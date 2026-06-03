/**
 * Activity Gate — voting weight modifier based on non-voting engagement.
 *
 * Users accumulate "engagement points" for non-voting actions within a group:
 *   - impulse_created  (5 pts)
 *   - draft_submitted  (3 pts)
 *   - dm_sent         (1 pt)
 *   - invite_used     (2 pts)
 *
 * The multiplier is computed as:
 *   activityMultiplier = 1 + min(totalPoints / ENGAGEMENT_POINTS_FOR_MAX, 1) * (MAX_BOOST - 1)
 *
 * This yields a linear scale from 1.0 (no engagement) up to MAX_BOOST (full engagement).
 * Engagement outside a 30-day window decays to a flat 1.0 floor.
 */
export declare const ACTIVITY_WINDOW_DAYS = 30;
export declare const ENGAGEMENT_POINTS_FOR_MAX = 20;
export declare const MAX_BOOST = 2;
export type EngagementEvent = {
    eventType: "impulse_created" | "draft_submitted" | "dm_sent" | "invite_used";
    createdAt: Date;
};
/**
 * Compute total engagement points from a list of events filtered to the
 * activity window (default 30 days).
 */
export declare function engagementPoints(events: EngagementEvent[], now?: Date, windowDays?: number): number;
/**
 * Activity gate multiplier: 1.0 (no non-voting engagement) up to MAX_BOOST.
 */
export declare function activityGateMultiplier(events: EngagementEvent[], now?: Date): number;
/**
 * Return both the multiplier and the raw point breakdown for audit / display.
 */
export declare function activityGateBreakdown(events: EngagementEvent[], now?: Date): {
    multiplier: number;
    points: number;
    pointsMax: number;
    windowDays: number;
};
/** Multiplier applied to voting weight for vouched members */
export declare const VOUCH_BOOST = 1.5;
/**
 * Vouch multiplier: 1.0 for non-vouched, VOUCH_BOOST for vouched.
 */
export declare function vouchMultiplier(isVouched: boolean): number;
/**
 * Combined voting weight that applies both the activity gate multiplier
 * and the vouch boost on top of the base tenure weight.
 *
 *   finalWeight = Math.round(baseWeight * activityMultiplier * vouchMultiplier)
 *
 * Base weight is always at least 1, and the final weight is at least 1.
 */
export declare function combinedVoteWeight(baseWeight: number, activityMultiplier: number, isVouched: boolean): number;
//# sourceMappingURL=activity-gate.d.ts.map