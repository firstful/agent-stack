export interface QueuedImpulse {
    id: string;
    createdBy: string;
    createdAt: Date;
    tenureDays: number;
}
/**
 * Sort impulses by tenure-weighted priority:
 * Higher tenure = higher position (lower queue number).
 * Tie-break by createdAt (older first).
 */
export declare function sortQueue(impulses: QueuedImpulse[]): QueuedImpulse[];
export declare function assignQueuePositions(impulses: QueuedImpulse[]): (QueuedImpulse & {
    position: number;
})[];
//# sourceMappingURL=queue.d.ts.map