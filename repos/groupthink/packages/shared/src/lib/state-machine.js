const VALID_TRANSITIONS = {
    queued: ["voting", "discarded"],
    voting: ["composing", "expired"],
    composing: ["summarizing", "expired"],
    summarizing: ["approval", "expired"],
    approval: ["broadcast", "discarded"],
    broadcast: [],
    expired: [],
    discarded: [],
};
export function canTransition(from, to) {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid transition: ${from} → ${to}`);
    }
}
//# sourceMappingURL=state-machine.js.map