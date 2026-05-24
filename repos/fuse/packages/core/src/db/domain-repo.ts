import pg from "pg";
import { z } from "zod";
import type { Pool } from "pg";
import type { DomainConfig, DnsRecord, Domain as DomainType, TrustLevel } from "../types/domain.js";
import { DomainRowSchema, DnsRecordRowSchema } from "./schema.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type DomainRow = z.infer<typeof DomainRowSchema>;
type DnsRecordRow = z.infer<typeof DnsRecordRowSchema>;

// DnsRecord rows always include an id; use a richer interface here.
interface FullDnsRecord extends DnsRecord {
  id: string;
}

function toDomain(row: DomainRow): DomainType {
  return {
    id: row.id,
    name: row.name,
    contactEmail: row.contact_email,
    verified: row.verified,
    active: row.active,
    trustLevel: row.trust_level as TrustLevel,
    dnsRecords: [],
    config: row.config as DomainConfig,
    createdAt: row.created_at,
  };
}

function toDnsRecord(row: DnsRecordRow): FullDnsRecord {
  return {
    id: row.id,
    label: row.label,
    rdata: row.rdata,
    ttl: row.ttl,
    domainId: row.domain_id,
  };
}

// ---------------------------------------------------------------------------
// Domain methods
// ---------------------------------------------------------------------------

export async function createDomain(
  pool: Pool,
  { name, contactEmail }: { name: string; contactEmail: string },
): Promise<DomainType> {
  const { rows } = await pool.query<DomainRow>(
    `
    INSERT INTO domains (name, contact_email)
    VALUES ($1, $2)
    RETURNING *
    `,
    [name, contactEmail],
  );
  return toDomain(rows[0]);
}

export async function getDomainById(
  pool: Pool,
  id: string,
): Promise<DomainType | null> {
  const { rows } = await pool.query<DomainRow>(
    `SELECT * FROM domains WHERE id = $1`,
    [id],
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getDomainByName(
  pool: Pool,
  name: string,
): Promise<DomainType | null> {
  const { rows } = await pool.query<DomainRow>(
    `SELECT * FROM domains WHERE name = $1`,
    [name],
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function updateDomain(
  pool: Pool,
  id: string,
  data: Partial<{
    name: string;
    contactEmail: string;
    verified: boolean;
    active: boolean;
    trustLevel: TrustLevel;
    config: DomainConfig;
  }>,
): Promise<DomainType | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.contactEmail !== undefined) {
    fields.push(`contact_email = $${idx++}`);
    values.push(data.contactEmail);
  }
  if (data.verified !== undefined) {
    fields.push(`verified = $${idx++}`);
    values.push(data.verified);
  }
  if (data.active !== undefined) {
    fields.push(`active = $${idx++}`);
    values.push(data.active);
  }
  if (data.trustLevel !== undefined) {
    fields.push(`trust_level = $${idx++}`);
    values.push(data.trustLevel);
  }
  if (data.config !== undefined) {
    fields.push(`config = $${idx++}`);
    values.push(data.config);
  }

  if (fields.length === 0) {
    return getDomainById(pool, id);
  }

  values.push(id);
  const { rows } = await pool.query<DomainRow>(
    `UPDATE domains SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function listDomains(pool: Pool): Promise<DomainType[]> {
  const { rows } = await pool.query<DomainRow>(`SELECT * FROM domains`);
  return rows.map(toDomain);
}

export async function deleteDomain(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM domains WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function setTrustLevel(
  pool: Pool,
  domainId: string,
  level: TrustLevel,
): Promise<void> {
  await pool.query(`UPDATE domains SET trust_level = $1 WHERE id = $2`, [level, domainId]);
}

// ---------------------------------------------------------------------------
// DNS record methods
// ---------------------------------------------------------------------------

export async function createDnsRecord(
  pool: Pool,
  { domainId, label, rdata, ttl }: { domainId: string; label: string; rdata: string[]; ttl: number },
): Promise<FullDnsRecord> {
  const { rows } = await pool.query<DnsRecordRow>(
    `
    INSERT INTO dns_records (domain_id, label, rdata, ttl)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (domain_id, label) DO UPDATE SET
      rdata = EXCLUDED.rdata,
      ttl = EXCLUDED.ttl
    RETURNING *
    `,
    [domainId, label, rdata, ttl],
  );
  return toDnsRecord(rows[0]);
}

export async function getDnsRecordsByDomain(
  pool: Pool,
  domainId: string,
): Promise<FullDnsRecord[]> {
  const { rows } = await pool.query<DnsRecordRow>(
    `SELECT * FROM dns_records WHERE domain_id = $1`,
    [domainId],
  );
  return rows.map(toDnsRecord);
}
