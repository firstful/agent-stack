/**
 * Structured audit logging for Groupthink.
 *
 * Writes state-changing operations to the `audit_logs` table for
 * administrative review, fraud investigation, and compliance.
 *
 * Usage:
 *   auditLog(c).db(userId).action("group.create")
 *     .group(groupId).target(targetId).detail({...}).log();
 */
import type { Context } from "hono";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@groupthink/db";

// ── Action type taxonomy ──
export const AuditActions = {
  // Auth
  UserRegister: "user.register",
  UserUpdateUsername: "user.update_username",
  // Groups
  GroupCreate: "group.create",
  GroupUpdateSettings: "group.update_settings",
  GroupBlock: "group.block",
  GroupUnblock: "group.unblock",
  GroupJoin: "group.join",
  GroupLeave: "group.leave",
  GroupInviteCodeCreate: "group.invite_code.create",
  GroupNicknameSet: "group.nickname.set",
  GroupNicknameDelete: "group.nickname.delete",
  // Impulses
  ImpulseCreate: "impulse.create",
  ImpulseVote: "impulse.vote",
  // Drafts
  DraftSubmit: "draft.submit",
  // Messages
  MessageRevoke: "message.revoke",
  MessageEndorse: "message.endorse",
  MessageUnendorse: "message.unendorse",
  // DMs
  DmSend: "dm.send",
  // Admin
  AdminBannedWordAdd: "admin.banned_word.add",
  AdminBannedWordRemove: "admin.banned_word.remove",
  AdminFraudAuditLog: "admin.fraud_audit_log",
  AdminShadowBanCreate: "admin.shadow_ban.create",
  AdminShadowBanLift: "admin.shadow_ban.lift",
  // Governance
  GovernanceKickInitiate: "governance.kick.initiate",
  GovernanceKickVote: "governance.kick.vote",
  GovernanceKickExecute: "governance.kick.execute",
  GovernanceSplitInitiate: "governance.split.initiate",
  GovernanceSplitSelect: "governance.split.select",
  GovernanceSplitExecute: "governance.split.execute",
  GovernanceMergeInitiate: "governance.merge.initiate",
  GovernanceMergeApprove: "governance.merge.approve",
  GovernanceMergeExecute: "governance.merge.execute",
  GovernanceSabbaticalInitiate: "governance.sabbatical.initiate",
  GovernanceSabbaticalVote: "governance.sabbatical.vote",
  GovernanceSabbaticalExecute: "governance.sabbatical.execute",
  // Reports
  ReportCreate: "report.create",
  ReportReview: "report.review",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

// ── Fluent Builder ──

export class AuditLogBuilder {
  private _db: PostgresJsDatabase<typeof schema>;
  private _action: AuditAction | null = null;
  private _userId: string | null = null;
  private _groupId: string | null = null;
  private _targetId: string | null = null;
  private _details: Record<string, unknown> | null = null;
  private _ip: string | null = null;
  private _userAgent: string | null = null;

  constructor(db: PostgresJsDatabase<typeof schema>) {
    this._db = db;
  }

  /** The user who performed the action. */
  user(userId: string): this {
    this._userId = userId;
    return this;
  }

  /** The audit action type. */
  action(action: AuditAction): this {
    this._action = action;
    return this;
  }

  /** The group context (if any). */
  group(groupId: string): this {
    this._groupId = groupId;
    return this;
  }

  /** The primary entity acted upon (message ID, impulse ID, etc.). */
  target(targetId: string): this {
    this._targetId = targetId;
    return this;
  }

  /** Free-form structured metadata. */
  detail(details: Record<string, unknown>): this {
    this._details = details;
    return this;
  }

  /** Capture request context (IP + user-agent). */
  captureRequest(c: Context): this {
    this._ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null;
    this._userAgent = c.req.header("user-agent") ?? null;
    return this;
  }

  /**
   * Write the audit entry to the database.
   * Returns immediately — does not await.
   */
  async log(): Promise<void> {
    if (!this._action) throw new Error("audit action is required");
    await this._db.insert(schema.auditLogs).values({
      action: this._action,
      userId: this._userId,
      groupId: this._groupId,
      targetId: this._targetId,
      details: this._details,
      ip: this._ip,
      userAgent: this._userAgent,
    });
  }
}

// ── Factory ──

export function auditLog(
  db: PostgresJsDatabase<typeof schema>,
): AuditLogBuilder {
  return new AuditLogBuilder(db);
}
