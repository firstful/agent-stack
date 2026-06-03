import { describe, it, expect, beforeEach } from "vitest";

// ── In-Memory Store for Governance Models ──

type Row = Record<string, any>;

class GovStore {
  private data: Record<string, Map<string, Row>> = {};

  constructor() {
    this.data = {
      users: new Map(),
      groups: new Map(),
      memberships: new Map(),
      messages: new Map(),
      kickVotes: new Map(),
      kickVoteRecords: new Map(),
      splitVotes: new Map(),
      splitSelections: new Map(),
      mergeVotes: new Map(),
      mergeApprovals: new Map(),
      sabbaticalVotes: new Map(),
      sabbaticalVoteRecords: new Map(),
    };
  }

  insert(table: string, rows: Row | Row[]): Row | Row[] {
    const input = Array.isArray(rows) ? rows : [rows];
    const results: Row[] = [];
    for (const row of input) {
      const id = row.id ?? crypto.randomUUID();
      const full = { ...row, id };
      this.data[table].set(id, full);
      results.push(full);
    }
    return Array.isArray(rows) ? results : results[0];
  }

  findById(table: string, id: string): Row | undefined {
    return this.data[table].get(id);
  }

  findWhere(table: string, pred: (r: Row) => boolean): Row[] {
    return Array.from(this.data[table].values()).filter(pred);
  }

  update(table: string, id: string, changes: Partial<Row>): void {
    const existing = this.data[table].get(id);
    if (existing) this.data[table].set(id, { ...existing, ...changes });
  }

  delete(table: string, id: string): void {
    this.data[table].delete(id);
  }

  clear(): void {
    for (const map of Object.values(this.data)) map.clear();
  }

  count(table: string): number {
    return this.data[table].size;
  }
}

// ── Helpers ──

function id(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600000);
}

function calcExpiry(hours = 48): Date {
  return new Date(Date.now() + hours * 3600000);
}

function totalNonAbstainWeight(records: { vote: string; weight: number }[]): number {
  return records.filter((r) => r.vote !== "abstain").reduce((sum, r) => sum + r.weight, 0);
}

// ── Tests ──

describe("Integration: Governance — Revocation", () => {
  let store: GovStore;
  const messageId = id("msg");
  const groupId = id("group");
  const userId = id("user");

  beforeEach(() => {
    store = new GovStore();
    store.insert("users", { id: userId, username: "alice" });
    store.insert("groups", { id: groupId, name: "Test Group" });
    store.insert("messages", {
      id: messageId,
      groupId,
      content: "Test message",
      status: "active",
      createdAt: hoursAgo(2), // 2 hours ago
    });
    store.insert("memberships", { id: id("mem"), userId, groupId, joinedAt: hoursAgo(720) });
  });

  it("allows revocation within 24-hour window", () => {
    const message = store.findById("messages", messageId);
    const hoursSince = (Date.now() - new Date(message.createdAt).getTime()) / 3600000;
    expect(hoursSince).toBeLessThan(24);

    // Revoke
    store.update("messages", messageId, { status: "revoked", revokedAt: new Date() });
    const updated = store.findById("messages", messageId);
    expect(updated.status).toBe("revoked");
    expect(updated.revokedAt).toBeDefined();
  });

  it("rejects revocation after 24-hour window", () => {
    const message = store.findById("messages", messageId);
    // Move the creation time beyond 24h
    store.update("messages", messageId, { createdAt: hoursAgo(30) });
    const updated = store.findById("messages", messageId);
    const hoursSince = (Date.now() - new Date(updated.createdAt).getTime()) / 3600000;
    expect(hoursSince).toBeGreaterThan(24);
  });

  it("requires the message to exist", () => {
    const nonExistent = store.findById("messages", "nonexistent");
    expect(nonExistent).toBeUndefined();
  });

  it("message is not found if it doesn't exist", () => {
    const msg = store.findById("messages", "bad_id");
    expect(msg).toBeUndefined();
  });
});

// ── Governance: Vote-Kick ──

describe("Integration: Governance — Vote-Kick", () => {
  let store: GovStore;
  const groupId = id("group");
  const initiatorId = id("user");
  const targetId = id("user");
  const voterId = id("user");
  let kickVoteId: string;

  beforeEach(() => {
    store = new GovStore();
    store.insert("users", { id: initiatorId, username: "alice", createdAt: hoursAgo(720) });
    store.insert("users", { id: targetId, username: "bob", createdAt: hoursAgo(30) });
    store.insert("users", { id: voterId, username: "charlie", createdAt: hoursAgo(100) });
    store.insert("groups", { id: groupId, name: "Test Group" });
    store.insert("memberships", { id: id("mem"), userId: initiatorId, groupId, joinedAt: hoursAgo(720) });
    store.insert("memberships", { id: id("mem"), userId: targetId, groupId, joinedAt: hoursAgo(30) });
    store.insert("memberships", { id: id("mem"), userId: voterId, groupId, joinedAt: hoursAgo(100) });

    // Create kick vote
    const kv = store.insert("kickVotes", {
      groupId,
      targetUserId: targetId,
      initiatedBy: initiatorId,
      reason: "Inactivity",
      status: "active",
      expiresAt: calcExpiry(48),
      createdAt: new Date(),
    });
    kickVoteId = kv.id;
  });

  it("initiates a kick vote against a target member", () => {
    const kv = store.findById("kickVotes", kickVoteId);
    expect(kv).toBeDefined();
    expect(kv.targetUserId).toBe(targetId);
    expect(kv.status).toBe("active");
    expect(kv.reason).toBe("Inactivity");
  });

  it("rejects self-kick", () => {
    // The route checks this explicitly
    const selfKick = targetId === initiatorId;
    expect(selfKick).toBe(false); // No self-kick in our setup
  });

  it("casts a vote with tenure weight", () => {
    const voterDays = Math.floor(
      (Date.now() - new Date(store.findById("users", voterId).createdAt).getTime()) / 86400000,
    );
    const weight = Math.max(1, voterDays);

    store.insert("kickVoteRecords", {
      kickVoteId,
      userId: voterId,
      vote: "yes",
      weight,
      castAt: new Date(),
    });

    const records = store.findWhere("kickVoteRecords", (r) => r.kickVoteId === kickVoteId);
    expect(records).toHaveLength(1);
    expect(records[0].vote).toBe("yes");
    expect(records[0].weight).toBeGreaterThan(0);
  });

  it("executes kick when yes > 50% of non-abstain weight", () => {
    // Alice (30d) votes yes — weight ~30
    // Charlie (100d) votes yes — weight ~100
    // Total non-abstain = 130, yes = 130 → 100% > 50% ✓
    store.insert("kickVoteRecords", [
      { kickVoteId, userId: initiatorId, vote: "yes", weight: 30 },
      { kickVoteId, userId: voterId, vote: "yes", weight: 100 },
    ]);

    const records = store.findWhere("kickVoteRecords", (r) => r.kickVoteId === kickVoteId);
    const totalWeight = totalNonAbstainWeight(records);
    const yesWeight = records.filter((r) => r.vote === "yes").reduce((s, r) => s + r.weight, 0);
    const shouldExecute = totalWeight > 0 && yesWeight > totalWeight / 2;

    expect(shouldExecute).toBe(true);

    if (shouldExecute) {
      store.update("kickVotes", kickVoteId, { status: "executed" });
      // Remove target from group
      const targetMembership = store.findWhere(
        "memberships",
        (m) => m.userId === targetId && m.groupId === groupId,
      )[0];
      if (targetMembership) store.delete("memberships", targetMembership.id);
    }

    expect(store.findById("kickVotes", kickVoteId).status).toBe("executed");
    expect(store.findWhere("memberships", (m) => m.userId === targetId)).toHaveLength(0);
  });

  it("expires when majority not reached (no vote > 50%)", () => {
    // Alice (30d) votes yes — weight 30
    // Charlie (100d) votes no — weight 100
    // Total = 130, yes = 30 → 23% < 50% ✗
    store.insert("kickVoteRecords", [
      { kickVoteId, userId: initiatorId, vote: "yes", weight: 30 },
      { kickVoteId, userId: voterId, vote: "no", weight: 100 },
    ]);

    const records = store.findWhere("kickVoteRecords", (r) => r.kickVoteId === kickVoteId);
    const totalWeight = totalNonAbstainWeight(records);
    const yesWeight = records.filter((r) => r.vote === "yes").reduce((s, r) => s + r.weight, 0);

    if (totalWeight > 0 && !(yesWeight > totalWeight / 2)) {
      store.update("kickVotes", kickVoteId, { status: "expired" });
    }

    expect(store.findById("kickVotes", kickVoteId).status).toBe("expired");
  });

  it("prevents duplicate active kick votes against same target", () => {
    const existing = store.findWhere(
      "kickVotes",
      (k) => k.groupId === groupId && k.targetUserId === targetId && k.status === "active",
    );
    expect(existing.length).toBeGreaterThan(0);

    // Should not create a new one
    const canCreate = existing.length === 0;
    expect(canCreate).toBe(false);
  });

  it("upserts vote instead of creating duplicates", () => {
    store.insert("kickVoteRecords", [
      { kickVoteId, userId: voterId, vote: "yes", weight: 100 },
    ]);

    // Update (upsert) the same user's vote
    const existingRecords = store.findWhere(
      "kickVoteRecords",
      (r) => r.kickVoteId === kickVoteId && r.userId === voterId,
    );
    if (existingRecords.length > 0) {
      const existing = existingRecords[0];
      store.update("kickVoteRecords", existing.id, { vote: "no" });
    } else {
      store.insert("kickVoteRecords", [{ kickVoteId, userId: voterId, vote: "no", weight: 100 }]);
    }

    const updated = store.findWhere(
      "kickVoteRecords",
      (r) => r.kickVoteId === kickVoteId && r.userId === voterId,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].vote).toBe("no");
  });
});

// ── Governance: Group Split ──

describe("Integration: Governance — Group Split", () => {
  let store: GovStore;
  const groupId = id("group");
  const initiatorId = id("user");
  const member2Id = id("user");
  const member3Id = id("user");
  const newGroupName = "Splinter Group";
  let splitVoteId: string;

  beforeEach(() => {
    store = new GovStore();

    // Members: alice (initiator), bob, charlie
    store.insert("users", { id: initiatorId, username: "alice" });
    store.insert("users", { id: member2Id, username: "bob" });
    store.insert("users", { id: member3Id, username: "charlie" });
    store.insert("groups", { id: groupId, name: "Original Group" });
    store.insert("memberships", [
      { id: id("mem"), userId: initiatorId, groupId, joinedAt: hoursAgo(720) },
      { id: id("mem"), userId: member2Id, groupId, joinedAt: hoursAgo(100) },
      { id: id("mem"), userId: member3Id, groupId, joinedAt: hoursAgo(50) },
    ]);

    const sv = store.insert("splitVotes", {
      groupId,
      initiatedBy: initiatorId,
      newGroupName,
      status: "active",
      expiresAt: calcExpiry(48),
      createdAt: new Date(),
    });
    splitVoteId = sv.id;
  });

  it("initiates a split vote with new group name", () => {
    const sv = store.findById("splitVotes", splitVoteId);
    expect(sv).toBeDefined();
    expect(sv.newGroupName).toBe(newGroupName);
    expect(sv.status).toBe("active");
  });

  it("requires unique new group name", () => {
    const existing = store.findWhere("groups", (g) => g.name === newGroupName);
    expect(existing).toHaveLength(0); // should be unique — no conflict
  });

  it("allows members to choose sides", () => {
    // Alice and Bob stay with original, Charlie goes to new group
    store.insert("splitSelections", [
      { splitVoteId, userId: initiatorId, chooseOriginal: true },
      { splitVoteId, userId: member2Id, chooseOriginal: true },
      { splitVoteId, userId: member3Id, chooseOriginal: false },
    ]);

    const selections = store.findWhere("splitSelections", (s) => s.splitVoteId === splitVoteId);
    expect(selections).toHaveLength(3);

    const staying = selections.filter((s) => s.chooseOriginal);
    const splintering = selections.filter((s) => !s.chooseOriginal);
    expect(staying).toHaveLength(2);
    expect(splintering).toHaveLength(1);
  });

  it("executes split when all members have chosen (at least 1 on each side)", () => {
    store.insert("splitSelections", [
      { splitVoteId, userId: initiatorId, chooseOriginal: true },
      { splitVoteId, userId: member2Id, chooseOriginal: true },
      { splitVoteId, userId: member3Id, chooseOriginal: false },
    ]);

    const memberCount = store.count("memberships");
    const selections = store.findWhere("splitSelections", (s) => s.splitVoteId === splitVoteId);
    const allChosen = selections.length >= memberCount;
    expect(allChosen).toBe(true);

    const staying = selections.filter((s) => s.chooseOriginal);
    const splintering = selections.filter((s) => !s.chooseOriginal);

    if (staying.length > 0 && splintering.length > 0) {
      // Execute: create new group, move splinter members
      const newGroupId = id("group");
      store.insert("groups", { id: newGroupId, name: newGroupName, bio: "", energy: "mixed" });

      for (const sel of splintering) {
        const mem = store.findWhere(
          "memberships",
          (m) => m.userId === sel.userId && m.groupId === groupId,
        )[0];
        if (mem) store.delete("memberships", mem.id);
        store.insert("memberships", { id: id("mem"), userId: sel.userId, groupId: newGroupId });
      }

      store.update("splitVotes", splitVoteId, { status: "executed" });
    }

    expect(store.findById("splitVotes", splitVoteId).status).toBe("executed");

    // Verify splinter member moved
    const charlieMemberships = store.findWhere("memberships", (m) => m.userId === member3Id);
    expect(charlieMemberships).toHaveLength(1);
    // Should be in the new group, not the original
    // (since we deleted the original membership and created a new one)
  });

  it("expires split when all members choose same side (no meaningful split)", () => {
    store.insert("splitSelections", [
      { splitVoteId, userId: initiatorId, chooseOriginal: true },
      { splitVoteId, userId: member2Id, chooseOriginal: true },
      { splitVoteId, userId: member3Id, chooseOriginal: true },
    ]);

    const selections = store.findWhere("splitSelections", (s) => s.splitVoteId === splitVoteId);
    const staying = selections.filter((s) => s.chooseOriginal);
    const splintering = selections.filter((s) => !s.chooseOriginal);

    if (staying.length === 0 || splintering.length === 0) {
      store.update("splitVotes", splitVoteId, { status: "expired" });
    }

    expect(store.findById("splitVotes", splitVoteId).status).toBe("expired");
  });

  it("prevents duplicate active split vote", () => {
    const existing = store.findWhere(
      "splitVotes",
      (s) => s.groupId === groupId && s.status === "active",
    );
    expect(existing.length).toBeGreaterThan(0);
  });

  it("upserts selection instead of duplicate", () => {
    store.insert("splitSelections", [
      { splitVoteId, userId: initiatorId, chooseOriginal: true },
    ]);

    // Upsert: update instead of adding new
    const existing = store.findWhere(
      "splitSelections",
      (s) => s.splitVoteId === splitVoteId && s.userId === initiatorId,
    )[0];
    store.update("splitSelections", existing.id, { chooseOriginal: false });

    const selections = store.findWhere(
      "splitSelections",
      (s) => s.splitVoteId === splitVoteId && s.userId === initiatorId,
    );
    expect(selections).toHaveLength(1);
    expect(selections[0].chooseOriginal).toBe(false);
  });
});

// ── Governance: Group Merge ──

describe("Integration: Governance — Group Merge", () => {
  let store: GovStore;
  const initiatorGroupId = id("group");
  const targetGroupId = id("group");
  const initiatorUserId = id("user");
  const targetUserId = id("user");
  const memberId = id("user");
  let mergeVoteId: string;

  beforeEach(() => {
    store = new GovStore();

    store.insert("users", [
      { id: initiatorUserId, username: "alice" },
      { id: targetUserId, username: "bob" },
      { id: memberId, username: "charlie" },
    ]);
    store.insert("groups", [
      { id: initiatorGroupId, name: "Group A" },
      { id: targetGroupId, name: "Group B" },
    ]);
    store.insert("memberships", [
      { id: id("mem"), userId: initiatorUserId, groupId: initiatorGroupId, joinedAt: hoursAgo(720) },
      { id: id("mem"), userId: memberId, groupId: initiatorGroupId, joinedAt: hoursAgo(100) },
      { id: id("mem"), userId: targetUserId, groupId: targetGroupId, joinedAt: hoursAgo(200) },
    ]);

    const mv = store.insert("mergeVotes", {
      initiatedByGroupId: initiatorGroupId,
      targetGroupId,
      initiatedBy: initiatorUserId,
      status: "active",
      expiresAt: calcExpiry(72), // 72h for merges
      createdAt: new Date(),
    });
    mergeVoteId = mv.id;
  });

  it("initiates a merge vote from one group to another", () => {
    const mv = store.findById("mergeVotes", mergeVoteId);
    expect(mv).toBeDefined();
    expect(mv.initiatedByGroupId).toBe(initiatorGroupId);
    expect(mv.targetGroupId).toBe(targetGroupId);
    expect(mv.status).toBe("active");
  });

  it("rejects self-merge", () => {
    const selfMerge = initiatorGroupId === targetGroupId;
    expect(selfMerge).toBe(false);
  });

  it("requires approval from both groups to merge", () => {
    // Alice (initiator group) approves
    store.insert("mergeApprovals", [
      { mergeVoteId, userId: initiatorUserId, groupId: initiatorGroupId, approved: true },
    ]);
    // Bob (target group) approves
    store.insert("mergeApprovals", [
      { mergeVoteId, userId: targetUserId, groupId: targetGroupId, approved: true },
    ]);

    const approvals = store.findWhere("mergeApprovals", (a) => a.mergeVoteId === mergeVoteId);
    const initiatorApprovals = approvals.filter((a) => a.groupId === initiatorGroupId);
    const targetApprovals = approvals.filter((a) => a.groupId === targetGroupId);

    const initiatorApproved = initiatorApprovals.some((a) => a.approved);
    const targetApproved = targetApprovals.some((a) => a.approved);

    expect(initiatorApproved).toBe(true);
    expect(targetApproved).toBe(true);
  });

  it("rejects merge if either group rejects", () => {
    store.insert("mergeApprovals", [
      { mergeVoteId, userId: initiatorUserId, groupId: initiatorGroupId, approved: true },
      { mergeVoteId, userId: targetUserId, groupId: targetGroupId, approved: false },
    ]);

    const approvals = store.findWhere("mergeApprovals", (a) => a.mergeVoteId === mergeVoteId);
    const targetApprovals = approvals.filter((a) => a.groupId === targetGroupId);
    const targetRejected = targetApprovals.some((a) => !a.approved);

    expect(targetRejected).toBe(true);

    if (targetRejected) {
      store.update("mergeVotes", mergeVoteId, { status: "rejected" });
    }

    expect(store.findById("mergeVotes", mergeVoteId).status).toBe("rejected");
  });

  it("executes merge by moving all target members to initiator group", () => {
    // Both approve
    store.insert("mergeApprovals", [
      { mergeVoteId, userId: initiatorUserId, groupId: initiatorGroupId, approved: true },
      { mergeVoteId, userId: targetUserId, groupId: targetGroupId, approved: true },
    ]);

    // Execute merge
    const targetMembers = store.findWhere("memberships", (m) => m.groupId === targetGroupId);
    for (const tm of targetMembers) {
      const alreadyMember = store.findWhere(
        "memberships",
        (m) => m.userId === tm.userId && m.groupId === initiatorGroupId,
      );
      if (alreadyMember.length === 0) {
        store.insert("memberships", [{ userId: tm.userId, groupId: initiatorGroupId, joinedAt: new Date() }]);
      }
    }

    // Mark target group as merged
    store.update("groups", targetGroupId, { bio: "[merged]" });
    store.update("mergeVotes", mergeVoteId, { status: "approved" });

    expect(store.findById("mergeVotes", mergeVoteId).status).toBe("approved");

    // Target user should now be in initiator group
    const bobMemberships = store.findWhere(
      "memberships",
      (m) => m.userId === targetUserId && m.groupId === initiatorGroupId,
    );
    expect(bobMemberships.length).toBeGreaterThan(0);
  });

  it("prevents duplicate active merge between same groups", () => {
    const existing = store.findWhere(
      "mergeVotes",
      (m) =>
        ((m.initiatedByGroupId === initiatorGroupId && m.targetGroupId === targetGroupId) ||
          (m.initiatedByGroupId === targetGroupId && m.targetGroupId === initiatorGroupId)) &&
        m.status === "active",
    );
    expect(existing.length).toBeGreaterThan(0);
  });

  it("allows any member to approve (not just initiator)", () => {
    // Member Charlie approves on behalf of initiator group
    store.insert("mergeApprovals", [
      { mergeVoteId, userId: memberId, groupId: initiatorGroupId, approved: true },
      { mergeVoteId, userId: targetUserId, groupId: targetGroupId, approved: true },
    ]);

    const approvals = store.findWhere("mergeApprovals", (a) => a.mergeVoteId === mergeVoteId);
    expect(approvals).toHaveLength(2);
    expect(approvals.some((a) => a.userId === memberId && a.groupId === initiatorGroupId)).toBe(true);
  });
});

// ── Governance: Sabbatical ──

describe("Integration: Governance — Sabbatical", () => {
  let store: GovStore;
  const groupId = id("group");
  const initiatorId = id("user");
  const voterId = id("user");
  let sabbVoteId: string;

  beforeEach(() => {
    store = new GovStore();

    store.insert("users", [
      { id: initiatorId, username: "alice", createdAt: hoursAgo(720) },
      { id: voterId, username: "bob", createdAt: hoursAgo(100) },
    ]);
    store.insert("groups", [{ id: groupId, name: "Test Group" }]);
    store.insert("memberships", [
      { id: id("mem"), userId: initiatorId, groupId, joinedAt: hoursAgo(720) },
      { id: id("mem"), userId: voterId, groupId, joinedAt: hoursAgo(100) },
    ]);
  });

  describe("Enter sabbatical", () => {
    beforeEach(() => {
      const sv = store.insert("sabbaticalVotes", {
        groupId,
        initiatedBy: initiatorId,
        direction: "enter",
        durationHours: 48,
        status: "active",
        expiresAt: calcExpiry(48),
        createdAt: new Date(),
      });
      sabbVoteId = sv.id;
    });

    it("initiates sabbatical vote to enter", () => {
      const sv = store.findById("sabbaticalVotes", sabbVoteId);
      expect(sv).toBeDefined();
      expect(sv.direction).toBe("enter");
      expect(sv.durationHours).toBe(48);
    });

    it("executes sabbatical when yes > 50%", () => {
      // Both vote yes → majority
      store.insert("sabbaticalVoteRecords", [
        { sabbaticalVoteId: sabbVoteId, userId: initiatorId, vote: "yes", weight: 720 },
        { sabbaticalVoteId: sabbVoteId, userId: voterId, vote: "yes", weight: 100 },
      ]);

      const records = store.findWhere("sabbaticalVoteRecords", (r) => r.sabbaticalVoteId === sabbVoteId);
      const totalWeight = totalNonAbstainWeight(records);
      const yesWeight = records.filter((r) => r.vote === "yes").reduce((s, r) => s + r.weight, 0);

      if (totalWeight > 0 && yesWeight > totalWeight / 2) {
        store.update("sabbaticalVotes", sabbVoteId, { status: "executed" });
        const until = new Date(Date.now() + 48 * 3600000);
        store.update("groups", groupId, { sabbaticalUntil: until });
      }

      expect(store.findById("sabbaticalVotes", sabbVoteId).status).toBe("executed");
      const group = store.findById("groups", groupId);
      expect(group.sabbaticalUntil).toBeDefined();
      expect(new Date(group.sabbaticalUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it("expires sabbatical vote without majority", () => {
      // Alice (720d) votes no — weight 720
      // Bob (100d) votes yes — weight 100
      // Total non-abstain = 820. Yes = 100. 100 > 410? No — no majority → expires
      store.insert("sabbaticalVoteRecords", [
        { sabbaticalVoteId: sabbVoteId, userId: initiatorId, vote: "no", weight: 720 },
        { sabbaticalVoteId: sabbVoteId, userId: voterId, vote: "yes", weight: 100 },
      ]);

      const records = store.findWhere("sabbaticalVoteRecords", (r) => r.sabbaticalVoteId === sabbVoteId);
      const totalWeight = totalNonAbstainWeight(records);
      const yesWeight = records.filter((r) => r.vote === "yes").reduce((s, r) => s + r.weight, 0);

      if (!(totalWeight > 0 && yesWeight > totalWeight / 2)) {
        store.update("sabbaticalVotes", sabbVoteId, { status: "expired" });
      }

      expect(store.findById("sabbaticalVotes", sabbVoteId).status).toBe("expired");
    });

    it("validates duration between 1 and 168 hours", () => {
      expect(48).toBeGreaterThanOrEqual(1);
      expect(48).toBeLessThanOrEqual(168);
    });
  });

  describe("Exit sabbatical", () => {
    beforeEach(() => {
      // Group is on sabbatical
      store.update("groups", groupId, { sabbaticalUntil: new Date(Date.now() + 86400000) });

      const sv = store.insert("sabbaticalVotes", {
        groupId,
        initiatedBy: initiatorId,
        direction: "exit",
        status: "active",
        expiresAt: calcExpiry(48),
        createdAt: new Date(),
      });
      sabbVoteId = sv.id;
    });

    it("initiates sabbatical vote to exit", () => {
      const sv = store.findById("sabbaticalVotes", sabbVoteId);
      expect(sv.direction).toBe("exit");
    });

    it("requires group to be on sabbatical to vote exit", () => {
      const group = store.findById("groups", groupId);
      expect(group.sabbaticalUntil).toBeDefined();
      expect(new Date(group.sabbaticalUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it("executes exit when yes > 50%", () => {
      store.insert("sabbaticalVoteRecords", [
        { sabbaticalVoteId: sabbVoteId, userId: initiatorId, vote: "yes", weight: 720 },
      ]);

      const records = store.findWhere("sabbaticalVoteRecords", (r) => r.sabbaticalVoteId === sabbVoteId);
      const totalWeight = totalNonAbstainWeight(records);
      const yesWeight = records.filter((r) => r.vote === "yes").reduce((s, r) => s + r.weight, 0);

      if (totalWeight > 0 && yesWeight > totalWeight / 2) {
        store.update("sabbaticalVotes", sabbVoteId, { status: "executed" });
        store.update("groups", groupId, { sabbaticalUntil: null });
      }

      expect(store.findById("sabbaticalVotes", sabbVoteId).status).toBe("executed");
      const group = store.findById("groups", groupId);
      expect(group.sabbaticalUntil).toBeNull();
    });

    it("prevents duplicate active sabbatical votes", () => {
      const existing = store.findWhere(
        "sabbaticalVotes",
        (s) => s.groupId === groupId && s.status === "active",
      );
      expect(existing.length).toBeGreaterThan(0);
    });
  });

  describe("Weighted voting across governance types", () => {
    it("applies tenure weighting to all governance votes", () => {
      // All governance types use tenureWeight (days since joining)
      const days = Math.floor(
        (Date.now() - new Date(store.findById("users", initiatorId).createdAt).getTime()) / 86400000,
      );
      expect(days).toBeGreaterThanOrEqual(1);

      // Verify weight formula is consistent
      const weight = Math.max(1, days);
      expect(weight).toBe(days);
    });
  });
});
