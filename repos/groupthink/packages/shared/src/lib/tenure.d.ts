export declare function tenureWeight(joinedAt: Date, now?: Date): number;
/** Decay multiplier based on days since last activity. */
export declare const REPUTATION_HALF_LIFE_DAYS = 60;
export declare function reputationDecay(lastActiveAt: Date, now?: Date): number;
export declare function effectiveWeight(joinedAt: Date, lastActiveAt: Date, now?: Date): number;
//# sourceMappingURL=tenure.d.ts.map