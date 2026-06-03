// All durations in milliseconds
export const MAX_VOTING_WINDOW = 4 * 60 * 60 * 1000; // 4 hours
export const MIN_VOTING_WINDOW = 10 * 60 * 1000; // 10 minutes
export const SUPERMAJORITY_RATIO = 0.67; // collapse if 67%+ consensus
const VELOCITY_DECAY_FACTOR = 0.3; // how much each vote shrinks the window
const QUORUM_RATIO = 0.5; // require 50% of members to vote before consensus matters
/**
 * Calculate remaining time for an adaptive voting window.
 * Returns remaining ms (0 means time's up).
 */
export function adaptiveRemaining(input) {
    const { totalMembers, votesCast, yesVotes, noVotes, elapsedMs } = input;
    // Base remaining: full window minus elapsed
    let remaining = MAX_VOTING_WINDOW - elapsedMs;
    if (remaining <= 0)
        return 0;
    // Vote velocity: shrink window proportionally to participation
    const participation = votesCast / Math.max(1, totalMembers);
    const velocityShrink = MAX_VOTING_WINDOW * participation * VELOCITY_DECAY_FACTOR;
    remaining -= velocityShrink;
    // Consensus collapse: if quorum met and supermajority reached, close immediately
    if (votesCast >= totalMembers * QUORUM_RATIO) {
        const totalVotes = yesVotes + noVotes;
        const consensus = totalVotes > 0 ? Math.max(yesVotes, noVotes) / totalVotes : 0;
        if (consensus >= SUPERMAJORITY_RATIO) {
            return 0;
        }
    }
    return Math.max(remaining, MIN_VOTING_WINDOW);
}
/**
 * Calculate composing timer (shorter than voting, stretches with engagement).
 */
export const MAX_COMPOSING_WINDOW = 60 * 60 * 1000; // 1 hour
export const MIN_COMPOSING_WINDOW = 5 * 60 * 1000; // 5 minutes
const DRAFT_EXTEND_FACTOR = 0.2; // each draft extends window by 20% of max
export function composingRemaining(draftCount, elapsedMs) {
    const extension = draftCount * MAX_COMPOSING_WINDOW * DRAFT_EXTEND_FACTOR;
    const remaining = MAX_COMPOSING_WINDOW + extension - elapsedMs;
    if (remaining <= 0)
        return 0;
    return Math.max(remaining, MIN_COMPOSING_WINDOW);
}
//# sourceMappingURL=adaptive-timer.js.map