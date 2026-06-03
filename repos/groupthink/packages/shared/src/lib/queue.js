/**
 * Sort impulses by tenure-weighted priority:
 * Higher tenure = higher position (lower queue number).
 * Tie-break by createdAt (older first).
 */
export function sortQueue(impulses) {
    return [...impulses].sort((a, b) => {
        const tenureDiff = b.tenureDays - a.tenureDays; // desc: higher tenure first
        if (tenureDiff !== 0)
            return tenureDiff;
        return a.createdAt.getTime() - b.createdAt.getTime(); // asc: older first
    });
}
export function assignQueuePositions(impulses) {
    const sorted = sortQueue(impulses);
    return sorted.map((imp, i) => ({ ...imp, position: i + 1 }));
}
//# sourceMappingURL=queue.js.map