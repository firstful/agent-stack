import { z } from "zod";
/**
 * IdentityType — the kind of entity represented by this Identity row.
 *
 * | Type | Use-case |
 * |------|---------|
 * | human  | Real person |
 * | agent  | AI/LLM agent connected through FUSE |
 * | shared | Shared/account identity (e.g. team address) |
 * | service| Machine-to-machine (bot, cron) |
 * | guest  | Unauthenticated / anonymous visitor with limited rights |
 */
export type IdentityType = "human" | "agent" | "shared" | "service" | "guest";
/**
 * IdentityKey — Ed25519 public-key bundle used for signing and
 * cross-federation identity verification.
 *
 * TODO: underspecified — key rotation strategy and key-expiry policy will
 * depend on the final trust-level model.
 */
export type IdentityKey = {
    /** SHA-256 fingerprint of the rawbytes. */
    fingerprint: string;
    /** Raw Ed25519 base32-encoded public key bytes. */
    rawbytes: string;
    /** Identity this key is bound to. */
    identityId: string;
    /** Key first registered. */
    createdAt: Date;
    /** Key optionally revoked before expiry. */
    revokedAt: Date | null;
    /** Key revoked true? */
    revoked: boolean;
};
/**
 * Identity — a single actor in FUSE: a person, a bot, or a service account.
 */
export type Identity = {
    /** PK. */
    id: string;
    /** FK → domains.id — the domain this identity belongs to. */
    domainId: string;
    /** Primary display label. */
    displayName: string;
    /** Unique handle within the domain (locals part of email address). */
    handle: string;
    /** Identity type. */
    type: IdentityType;
    /** Avatar URL (optional — stored externally in object store). */
    avatarUrl: string | null;
    /** Biographical blurb. */
    bio: string | null;
    /** Whether the identity is currently banned from the domain. */
    banned: boolean;
    /** Expiry timestamp for temporary guest accounts. */
    expiresAt: Date | null;
    /** Created timestamp. */
    createdAt: Date;
    /** Last activity timestamp; updated by presence heartbeat. */
    lastSeenAt: Date | null;
    /** Whether the identity has opted out of federation. */
    optOutOfFederation: boolean;
};
/**
 * Zod schema for Identity.
 */
export declare const IdentitySchema: z.ZodType<Identity>;
//# sourceMappingURL=identity.d.ts.map