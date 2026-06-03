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
export const ACTIVITY_WINDOW_DAYS = 30;
export const ENGAGEMENT_POINTS_FOR_MAX = 20;
export const MAX_BOOST = 2.0;
const EVENT_POINTS = {
    impulse_created: 5,
    draft_submitted: 3,
    dm_sent: 1,
    invite_used: 2,
};
/**
 * Compute total engagement points from a list of events filtered to the
 * activity window (default 30 days).
 */
export function engagementPoints(events, now = new Date(), windowDays = ACTIVITY_WINDOW_DAYS) {
    const cutoff = new Date(now.getTime() - windowDays * 86400000);
    let total = 0;
    for (const ev of events) {
        if (ev.createdAt >= cutoff) {
            total += EVENT_POINTS[ev.eventType] ?? 0;
        }
    }
    return total;
}
/**
 * Activity gate multiplier: 1.0 (no non-voting engagement) up to MAX_BOOST.
 */
export function activityGateMultiplier(events, now) {
    const pts = engagementPoints(events, now);
    const ratio = Math.min(pts / ENGAGEMENT_POINTS_FOR_MAX, 1);
    return 1 + ratio * (MAX_BOOST - 1);
}
/**
 * Return both the multiplier and the raw point breakdown for audit / display.
 */
export function activityGateBreakdown(events, now) {
    const pts = engagementPoints(events, now);
    const ratio = Math.min(pts / ENGAGEMENT_POINTS_FOR_MAX, 1);
    return {
        multiplier: 1 + ratio * (MAX_BOOST - 1),
        points: pts,
        pointsMax: ENGAGEMENT_POINTS_FOR_MAX,
        windowDays: ACTIVITY_WINDOW_DAYS,
    };
}
// ═══════════════════════════════════════════════════════════
// Vouch System
// ═══════════════════════════════════════════════════════════
/** Multiplier applied to voting weight for vouched members */
export const VOUCH_BOOST = 1.5;
/**
 * Vouch multiplier: 1.0 for non-vouched, VOUCH_BOOST for vouched.
 */
export function vouchMultiplier(isVouched) {
    return isVouched ? VOUCH_BOOST : 1.0;
}
/**
 * Combined voting weight that applies both the activity gate multiplier
 * and the vouch boost on top of the base tenure weight.
 *
 *   finalWeight = Math.round(baseWeight * activityMultiplier * vouchMultiplier)
 *
 * Base weight is always at least 1, and the final weight is at least 1.
 */
export function combinedVoteWeight(baseWeight, activityMultiplier, isVouched) {
    const raw = baseWeight * activityMultiplier * vouchMultiplier(isVouched);
    return Math.max(1, Math.round(raw));
}
//# sourceMappingURL=activity-gate.js.map