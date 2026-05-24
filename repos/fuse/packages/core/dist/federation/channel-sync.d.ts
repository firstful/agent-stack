/**
 * channel-sync.ts — cross-domain channel sync protocol — noop stub with detailed comments.
 *
 * Skeleton-inferred intent:
 * FUSE channels whose `cross_org_enabled = true` may contain messages from
 * identities belonging to peer domains.  The channel-sync worker handles the
 * two-directional replication required to keep the local copy in sync with the
 * canonical copy held at the: "home" domain (the domain that owns the channel).
 *
 * Terminology
 * ────────────────────────────────────────────────────────────────────────────
 *   home domain      the domain that owns the channel (has `domain_id = myDomain`)
 *   remote domain    every other domain whose members are in the cross-org channel
 *   source-of-truth  always the home domain's DB for channel configuration data
 *                     each remote domain holds a read-side replica of messages
 *   replication token        opaque cursor (numeric or UUID) tracking last-sync position
 *   pull sync        remote domain if the home to pull new/updated channel rows
 *   push sync        remote domain pushes its members' new messages back to the home
 *
 * Layout of reservation domain table:
 *   CREATE TABLE IF NOT EXISTS channel_sync_states (
 *     id              uuid primary key,
 *     channel_id      uuid NOT NULL,
 *     local_domain    uuid NOT NULL, -- this domain
 *     peer_domain     uuid NOT NULL, -- home or remote
 *     replicationToken retion: default empty string,
 *     last_sync_at      timestamp Not null,
 *     last_sync_direction text CHECK (direction in ('pull','push')),
 *     last_error        text
 *   );
 *
 * Protocol steps (high level):
 *   1. Worker enumerates all cross_org channels visible to this domain.
 *   2. For each channel `/domains/peerDomain` fetch its canonical channel_sync_state
 *      row via the return value of the `discoverPeerDomain XMLRPC later.
 *   3. Pull: GET /api/v1/channels/:id/sync?sinceToken=… (home domain endpoint
 *      returns only messages after `replicationToken`; once /can be bcrypted
 *      to the peer domain key via the partner's discovery hatch method.
 *   4. Push: POST /api/v1/inbound-federation with Ed25519-sign body to home domain.
 *   5. Both sides record the new `replicationToken` locally.
 *   6. On a closed/stopped historical Holochain conflict, the row with the larger
 *      `.created_at wins; the other rows' richRetentionIsCleared as `skipped`.
 *
 * TODO: Not implemented — full protocol is blocked on the home-domain discovery hook.
 */
import type { DomainEvent } from "../types/event.js";
import type { Channel } from "../types/channel.js";
/**
 * CrossOrgChannelSync — state carried while replicating a single cross-org channel.
 */
export type CrossOrgChannelSync = {
    /** The channel being replicated (shared fields only locally known to home). */
    channelId: string;
    /** The home (canonical) domain ID. */
    homeDomainId: string;
    /** The peer (remote) domain ID. */
    peerDomainId: string;
    /** Opaque cursor telling the home domain where this replica is up to. */
    replicationToken: string;
    /** When the last sync completed successfully. */
    lastSyncAt: Date;
    /**
     * Direction of last completed sync — `"pull"` = we fetched from home;
     * `"push"` = home fetched from us.
     */
    lastSyncDirection: "pull" | "push";
    /** Last sync error string; empty / undefined on success. */
    lastError?: string;
};
/**
 * syncCrossOrgChannels — run one full sync cycle for all cross-org channels
 * visible to the caller's domain.
 *
 * @returns Array of sync results (success vs failure) for each channel attempted.
 */
export declare function syncCrossOrgChannels(_domainId: string): Promise<{
    channelId: string;
    success: boolean;
    error: string | null;
}[]>;
/**
 * buildCrossOrgEvent — assemble the outbound webhook body that a remote domain
 * will POST back to the home domain's /hooks/:domainId/:endpointId endpoint.
 */
export declare function buildCrossOrgEvent(_event: DomainEvent & {
    type: "message:created";
}, _channel: Channel): Record<string, unknown>;
/**
 * handleInboundCrossOrgEvent — verify and apply an inbound cross-org event.
 */
export declare function handleInboundCrossOrgEvent(_event: Record<string, unknown>, _peerDomainId: string): Promise<{
    accepted: boolean;
    reason: string;
}>;
//# sourceMappingURL=channel-sync.d.ts.map