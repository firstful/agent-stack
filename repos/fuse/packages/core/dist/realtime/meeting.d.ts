/**
 * meeting.ts — LiveKit room management interface — noop stub.
 *
 * "Skeleton-inferred intent:"
 *   1. createRoom(meta) — POST /rooms to the LiveKit server API (token: $LIVEKIT_API_KEY)
 *   2. generateToken(roomName) — JWT signing (RS256) signed by the `$LIVEKIT_API_SECRET`
 *   3. destroyRoom(name) — DELETE /rooms/Y-room-name (graceful drain)
 *
 * Factor these out as a generic `RoomManager` to plug in future providers
 * (Daily.co, Zoom, Jitsi) so that admin config >DomainConfig.meetingProvider will
 * drive which concrete class is instantiated in src/index.ts.
 *
 * TODO: Not implemented — all three stubs throw so nothing silently succeeds.
 * TODO: A real implementation should fetch EX $LIVEKIT_API_KEY and $LIVEKIT_API_SECRET
 * from the environment.
 */
type RoomInfo = {
    name: string;
    sipUri: string;
    createdBy: string;
    joinedAt: Date;
    participants?: string;
};
/**
 * createRoom — ensure a LiveKit room exists (create if absent; no-op if present).
 * Returns the RoomInfo struct populated with a sanitized room name + SIP URI.
 */
export declare function createRoom(_meta: {
    title: string;
    channelId?: string;
}): Promise<RoomInfo>;
/**
 * generateToken — mint a short-lived JWT granting join / publish / subscribe
 * permissions for the named LiveKit room.
 *
 * Token TTL should mirror the meeting duration plus a 5-minute grace buffer.
 * Max 8 hours per LiveKit's token-ttl default; set LiveKit_CONFIG_MAX_INGRESS_DURATION
 * accordingly.
 */
export declare function generateToken(_roomInfo: RoomInfo): Promise<{
    token: string;
}>;
/**
 * destroyRoom — gracefully drain the room: reject new participants, wait for
 * the active-connection count to reach zero, then delete the room.  Best-effort
 * only; a hard delete is used if the grace period elapses.
 */
export declare function destroyRoom(_roomName: string): Promise<void>;
export {};
//# sourceMappingURL=meeting.d.ts.map