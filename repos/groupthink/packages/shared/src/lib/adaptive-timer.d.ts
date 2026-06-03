export declare const MAX_VOTING_WINDOW: number;
export declare const MIN_VOTING_WINDOW: number;
export declare const SUPERMAJORITY_RATIO = 0.67;
interface TimerInput {
    totalMembers: number;
    votesCast: number;
    yesVotes: number;
    noVotes: number;
    elapsedMs: number;
}
/**
 * Calculate remaining time for an adaptive voting window.
 * Returns remaining ms (0 means time's up).
 */
export declare function adaptiveRemaining(input: TimerInput): number;
/**
 * Calculate composing timer (shorter than voting, stretches with engagement).
 */
export declare const MAX_COMPOSING_WINDOW: number;
export declare const MIN_COMPOSING_WINDOW: number;
export declare function composingRemaining(draftCount: number, elapsedMs: number): number;
export {};
//# sourceMappingURL=adaptive-timer.d.ts.map