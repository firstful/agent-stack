export function tenureWeight(joinedAt, now = new Date()) {
    const days = Math.floor((now.getTime() - joinedAt.getTime()) / 86400000);
    return Math.max(1, days);
}
/** Decay multiplier based on days since last activity. */
export const REPUTATION_HALF_LIFE_DAYS = 60;
export function reputationDecay(lastActiveAt, now = new Date()) {
    const daysSince = (now.getTime() - lastActiveAt.getTime()) / 86400000;
    if (daysSince <= 0)
        return 1;
    return Math.pow(0.5, daysSince / REPUTATION_HALF_LIFE_DAYS);
}
export function effectiveWeight(joinedAt, lastActiveAt, now) {
    return tenureWeight(joinedAt, now) * reputationDecay(lastActiveAt, now);
}
//# sourceMappingURL=tenure.js.map