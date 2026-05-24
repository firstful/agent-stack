import type { Pool } from "pg";
import type { Channel, ChannelType, ChannelMember, ChannelPermissions } from "../types/channel.js";
import { z } from "zod";
import { ChannelRowSchema, ChannelMemberRowSchema, ChannelPermissionRowSchema } from "./schema.js";

type ChannelRow = z.infer<typeof ChannelRowSchema>;
type ChannelMemberRow = z.infer<typeof ChannelMemberRowSchema>;
type ChannelPermissionRow = z.infer<typeof ChannelPermissionRowSchema>;

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    domainId: row.domain_id,
    name: row.name,
    type: row.type as ChannelType,
    description: row.description ?? null,
    config: row.config as Record<string, unknown>,
    crossOrgEnabled: row.cross_org_enabled,
    smtpAddress: row.smtp_address,
    createdById: row.created_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

function toChannelMember(row: ChannelMemberRow): ChannelMember {
  return {
    id: row.id,
    channelId: row.channel_id,
    identityId: row.identity_id,
    memberName: row.member_name ?? null,
    role: row.role as "owner" | "admin" | "member" | "guest",
    muted: row.muted,
    hidden: row.hidden,
    lastReadAt: row.last_read_at ?? null,
    joinedAt: row.joined_at,
    leftAt: row.left_at ?? null,
  };
}

function toChannelPermissions(row: ChannelPermissionRow): ChannelPermissions {
  return {
    channelId: row.channel_id,
    writeMembers: row.write_members,
    writeGuests: row.write_guests,
    writeCrossOrg: row.write_cross_org,
    maxAttachmentBytes: row.max_attachment_bytes,
    attachmentsEnabled: row.attachments_enabled,
    auditLog: Array.isArray(row.audit_log) ? (row.audit_log as unknown[]) : [],
    approvalRequired: row.approval_required as Record<string, unknown>,
  };
}

export async function createChannel(
  pool: Pool,
  data: {
    domainId: string;
    name: string;
    type: ChannelType;
    description?: string | null;
    config?: Record<string, unknown>;
    crossOrgEnabled?: boolean;
    smtpAddress: string;
    createdById: string;
  },
): Promise<Channel> {
  const { rows } = await pool.query<ChannelRow>(
    `INSERT INTO channels (domain_id, name, type, description, config, cross_org_enabled, smtp_address, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.domainId,
      data.name,
      data.type,
      data.description ?? null,
      data.config ?? {},
      data.crossOrgEnabled ?? false,
      data.smtpAddress,
      data.createdById,
    ],
  );
  return toChannel(rows[0]);
}

export async function getChannelById(pool: Pool, id: string): Promise<Channel | null> {
  const { rows } = await pool.query<ChannelRow>(`SELECT * FROM channels WHERE id = $1`, [id]);
  return rows[0] ? toChannel(rows[0]) : null;
}

export async function listChannelsByDomain(pool: Pool, domainId: string): Promise<Channel[]> {
  const { rows } = await pool.query<ChannelRow>(`SELECT * FROM channels WHERE domain_id = $1`, [domainId]);
  return rows.map(toChannel);
}

export async function updateChannel(
  pool: Pool,
  id: string,
  data: Partial<{
    name: string;
    type: ChannelType;
    description: string | null;
    config: Record<string, unknown>;
    crossOrgEnabled: boolean;
    smtpAddress: string;
  }>,
): Promise<Channel | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.type !== undefined) {
    fields.push(`type = $${idx++}`);
    values.push(data.type);
  }
  if (data.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(data.description);
  }
  if (data.config !== undefined) {
    fields.push(`config = $${idx++}`);
    values.push(data.config);
  }
  if (data.crossOrgEnabled !== undefined) {
    fields.push(`cross_org_enabled = $${idx++}`);
    values.push(data.crossOrgEnabled);
  }
  if (data.smtpAddress !== undefined) {
    fields.push(`smtp_address = $${idx++}`);
    values.push(data.smtpAddress);
  }

  if (fields.length === 0) {
    return getChannelById(pool, id);
  }

  values.push(id);
  const { rows } = await pool.query<ChannelRow>(
    `UPDATE channels SET ${fields.join(", ")}, updated_at = now() WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0] ? toChannel(rows[0]) : null;
}

export async function deleteChannel(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM channels WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function addMember(
  pool: Pool,
  { channelId, identityId, role }: { channelId: string; identityId: string; role: "owner" | "admin" | "member" | "guest" },
): Promise<ChannelMember> {
  const { rows } = await pool.query<ChannelMemberRow>(
    `INSERT INTO channel_members (channel_id, identity_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, identity_id) DO UPDATE SET role = EXCLUDED.role, left_at = NULL
     RETURNING *`,
    [channelId, identityId, role],
  );
  return toChannelMember(rows[0]);
}

export async function removeMember(pool: Pool, channelId: string, identityId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM channel_members WHERE channel_id = $1 AND identity_id = $2`,
    [channelId, identityId],
  );
  return (rowCount ?? 0) > 0;
}

export async function getMembers(pool: Pool, channelId: string): Promise<ChannelMember[]> {
  const { rows } = await pool.query<ChannelMemberRow>(
    `SELECT * FROM channel_members WHERE channel_id = $1 AND left_at IS NULL`,
    [channelId],
  );
  return rows.map(toChannelMember);
}

export async function getPermissions(pool: Pool, channelId: string): Promise<ChannelPermissions | null> {
  const { rows } = await pool.query<ChannelPermissionRow>(
    `SELECT * FROM channel_permissions WHERE channel_id = $1`,
    [channelId],
  );
  return rows[0] ? toChannelPermissions(rows[0]) : null;
}

export async function updatePermissions(
  pool: Pool,
  channelId: string,
  data: Partial<{
    writeMembers: boolean;
    writeGuests: boolean;
    writeCrossOrg: boolean;
    maxAttachmentBytes: number;
    attachmentsEnabled: boolean;
    auditLog: unknown[];
    approvalRequired: Record<string, unknown>;
  }>,
): Promise<ChannelPermissions> {
  const fields: string[] = [];
  const values: unknown[] = [channelId];
  let idx = 2;

  if (data.writeMembers !== undefined) {
    fields.push(`write_members = $${idx++}`);
    values.push(data.writeMembers);
  }
  if (data.writeGuests !== undefined) {
    fields.push(`write_guests = $${idx++}`);
    values.push(data.writeGuests);
  }
  if (data.writeCrossOrg !== undefined) {
    fields.push(`write_cross_org = $${idx++}`);
    values.push(data.writeCrossOrg);
  }
  if (data.maxAttachmentBytes !== undefined) {
    fields.push(`max_attachment_bytes = $${idx++}`);
    values.push(data.maxAttachmentBytes);
  }
  if (data.attachmentsEnabled !== undefined) {
    fields.push(`attachments_enabled = $${idx++}`);
    values.push(data.attachmentsEnabled);
  }
  if (data.auditLog !== undefined) {
    fields.push(`audit_log = $${idx++}`);
    values.push(data.auditLog);
  }
  if (data.approvalRequired !== undefined) {
    fields.push(`approval_required = $${idx++}`);
    values.push(data.approvalRequired);
  }

  const updateClause = fields.length > 0 ? `ON CONFLICT (channel_id) DO UPDATE SET ${fields.join(", ")}` : '';
  const { rows } = await pool.query<ChannelPermissionRow>(
    `INSERT INTO channel_permissions (channel_id, write_members, write_guests, write_cross_org, max_attachment_bytes, attachments_enabled, audit_log, approval_required)
     VALUES ($1, TRUE, FALSE, FALSE, 10485760, TRUE, '[]'::jsonb, '{}'::jsonb)
     ${updateClause}
     RETURNING *`,
    values,
  );
  return toChannelPermissions(rows[0]);
}