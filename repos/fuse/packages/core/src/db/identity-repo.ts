import pg from "pg";
import { z } from "zod";
import type { Pool } from "pg";
import type { Identity, IdentityType, IdentityKey } from "../types/identity.js";
import { IdentityRowSchema, IdentityKeyRowSchema } from "./schema.js";

type IdentityRow = z.infer<typeof IdentityRowSchema>;
type IdentityKeyRow = z.infer<typeof IdentityKeyRowSchema>;

function toIdentity(row: IdentityRow): Identity {
  return {
    id: row.id,
    domainId: row.domain_id,
    displayName: row.display_name,
    handle: row.handle,
    type: row.type,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    banned: row.banned,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    optOutOfFederation: row.opt_out_of_federation,
  };
}

function toIdentityKey(row: IdentityKeyRow): IdentityKey {
  return {
    fingerprint: row.fingerprint,
    rawbytes: row.rawbytes,
    identityId: row.identity_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
    revoked: row.revoked,
  };
}

/**
 * Create a new identity.
 */
export async function createIdentity(
  pool: Pool,
  {
    domainId,
    displayName,
    handle,
    type,
    avatarUrl = null,
    bio = null,
    banned = false,
    expiresAt = null,
    optOutOfFederation = false,
  }: {
    domainId: string;
    displayName: string;
    handle: string;
    type: IdentityType;
    avatarUrl?: string | null;
    bio?: string | null;
    banned?: boolean;
    expiresAt?: Date | null;
    optOutOfFederation?: boolean;
  }
): Promise<Identity> {
  const { rows } = await pool.query<IdentityRow>(
    `
    INSERT INTO identities (
      domain_id, display_name, handle, type, avatar_url, bio, banned, expires_at, opt_out_of_federation
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
    `,
    [domainId, displayName, handle, type, avatarUrl, bio, banned, expiresAt, optOutOfFederation]
  );
  return toIdentity(rows[0]);
}

/**
 * Fetch identity by ID.
 */
export async function getIdentityById(
  pool: Pool,
  id: string
): Promise<Identity | null> {
  const { rows } = await pool.query<IdentityRow>(
    `SELECT * FROM identities WHERE id = $1`,
    [id]
  );
  return rows[0] ? toIdentity(rows[0]) : null;
}

/**
 * Fetch identity by handle within a domain.
 */
export async function getIdentityByHandle(
  pool: Pool,
  domainId: string,
  handle: string
): Promise<Identity | null> {
  const { rows } = await pool.query<IdentityRow>(
    `SELECT * FROM identities WHERE domain_id = $1 AND handle = $2`,
    [domainId, handle]
  );
  return rows[0] ? toIdentity(rows[0]) : null;
}

/**
 * List identities in a domain.
 */
export async function listIdentitiesByDomain(
  pool: Pool,
  domainId: string
): Promise<Identity[]> {
  const { rows } = await pool.query<IdentityRow>(
    `SELECT * FROM identities WHERE domain_id = $1`,
    [domainId]
  );
  return rows.map(toIdentity);
}

/**
 * Update mutable fields of an identity.
 */
export async function updateIdentity(
  pool: Pool,
  id: string,
  data: Partial<{
    displayName: string;
    handle: string;
    type: IdentityType;
    avatarUrl: string | null;
    bio: string | null;
    banned: boolean;
    expiresAt: Date | null;
    lastSeenAt: Date | null;
    optOutOfFederation: boolean;
  }>
): Promise<Identity | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.displayName !== undefined) {
    fields.push(`display_name = $${idx++}`);
    values.push(data.displayName);
  }
  if (data.handle !== undefined) {
    fields.push(`handle = $${idx++}`);
    values.push(data.handle);
  }
  if (data.type !== undefined) {
    fields.push(`type = $${idx++}`);
    values.push(data.type);
  }
  if (data.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${idx++}`);
    values.push(data.avatarUrl);
  }
  if (data.bio !== undefined) {
    fields.push(`bio = $${idx++}`);
    values.push(data.bio);
  }
  if (data.banned !== undefined) {
    fields.push(`banned = $${idx++}`);
    values.push(data.banned);
  }
  if (data.expiresAt !== undefined) {
    fields.push(`expires_at = $${idx++}`);
    values.push(data.expiresAt);
  }
  if (data.lastSeenAt !== undefined) {
    fields.push(`last_seen_at = $${idx++}`);
    values.push(data.lastSeenAt);
  }
  if (data.optOutOfFederation !== undefined) {
    fields.push(`opt_out_of_federation = $${idx++}`);
    values.push(data.optOutOfFederation);
  }

  if (fields.length === 0) {
    return getIdentityById(pool, id);
  }

  values.push(id);
  const { rows } = await pool.query<IdentityRow>(
    `UPDATE identities SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] ? toIdentity(rows[0]) : null;
}

/**
 * Delete an identity.
 * Returns true if deleted, false if not found.
 */
export async function deleteIdentity(
  pool: Pool,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM identities WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Add a new Ed25519 key for an identity.
 */
export async function addIdentityKey(
  pool: Pool,
  { identityId, fingerprint, rawbytes }: {
    identityId: string;
    fingerprint: string;
    rawbytes: string;
  }
): Promise<IdentityKey> {
  const { rows } = await pool.query<IdentityKeyRow>(
    `
    INSERT INTO identity_keys (
      identity_id, fingerprint, rawbytes
    )
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [identityId, fingerprint, rawbytes]
  );
  return toIdentityKey(rows[0]);
}

/**
 * Revoke an identity key by setting revoked=true and revoked_at=now().
 */
export async function revokeIdentityKey(
  pool: Pool,
  identityId: string,
  fingerprint: string
): Promise<void> {
  await pool.query(
    `UPDATE identity_keys SET revoked = true, revoked_at = NOW() WHERE identity_id = $1 AND fingerprint = $2`,
    [identityId, fingerprint]
  );
}

/**
 * Get all keys for an identity (including revoked ones).
 */
export async function getIdentityKeys(
  pool: Pool,
  identityId: string
): Promise<IdentityKey[]> {
  const { rows } = await pool.query<IdentityKeyRow>(
    `SELECT * FROM identity_keys WHERE identity_id = $1`,
    [identityId]
  );
  return rows.map(toIdentityKey);
}