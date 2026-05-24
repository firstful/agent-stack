import type { Pool } from "pg";
import type { Identity, IdentityType, IdentityKey } from "../types/identity.js";
/**
 * Create a new identity.
 */
export declare function createIdentity(pool: Pool, { domainId, displayName, handle, type, avatarUrl, bio, banned, expiresAt, optOutOfFederation, }: {
    domainId: string;
    displayName: string;
    handle: string;
    type: IdentityType;
    avatarUrl?: string | null;
    bio?: string | null;
    banned?: boolean;
    expiresAt?: Date | null;
    optOutOfFederation?: boolean;
}): Promise<Identity>;
/**
 * Fetch identity by ID.
 */
export declare function getIdentityById(pool: Pool, id: string): Promise<Identity | null>;
/**
 * Fetch identity by handle within a domain.
 */
export declare function getIdentityByHandle(pool: Pool, domainId: string, handle: string): Promise<Identity | null>;
/**
 * List identities in a domain.
 */
export declare function listIdentitiesByDomain(pool: Pool, domainId: string): Promise<Identity[]>;
/**
 * Update mutable fields of an identity.
 */
export declare function updateIdentity(pool: Pool, id: string, data: Partial<{
    displayName: string;
    handle: string;
    type: IdentityType;
    avatarUrl: string | null;
    bio: string | null;
    banned: boolean;
    expiresAt: Date | null;
    lastSeenAt: Date | null;
    optOutOfFederation: boolean;
}>): Promise<Identity | null>;
/**
 * Delete an identity.
 * Returns true if deleted, false if not found.
 */
export declare function deleteIdentity(pool: Pool, id: string): Promise<boolean>;
/**
 * Add a new Ed25519 key for an identity.
 */
export declare function addIdentityKey(pool: Pool, { identityId, fingerprint, rawbytes }: {
    identityId: string;
    fingerprint: string;
    rawbytes: string;
}): Promise<IdentityKey>;
/**
 * Revoke an identity key by setting revoked=true and revoked_at=now().
 */
export declare function revokeIdentityKey(pool: Pool, identityId: string, fingerprint: string): Promise<void>;
/**
 * Get all keys for an identity (including revoked ones).
 */
export declare function getIdentityKeys(pool: Pool, identityId: string): Promise<IdentityKey[]>;
//# sourceMappingURL=identity-repo.d.ts.map