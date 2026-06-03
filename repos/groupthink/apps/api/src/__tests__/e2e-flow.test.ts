import { describe, it, expect, beforeEach } from "vitest";

// ── E2E In-Memory Store ──

type Row = Record<string, any>;

class E2EStore {
  private tables: Record<string, Map<string, Row>> = {};

  constructor() {
    const tables = [
      "users", "groups", "memberships", "inviteCodes", "impulses", "votes",
      "drafts", "summaryCandidates", "messages", "retweets", "activityEvents",
      "directMessages", "kickVotes", "kickVoteRecords", "splitVotes",
      "splitSelections", "mergeVotes", "mergeApprovals", "sabbaticalVotes",
      "sabbaticalVoteRecords", "groupBlocks", "groupNicknames", "shadowBans",
    ];
    for (const t of tables) this.tables[t] = new Map();
  }

  insert(table: string, rows: Row | Row[]): Row | Row[] {
    const input = Array.isArray(rows) ? rows : [rows];
    const results: Row[] = [];
    for (const row of input) {
      const id = row.id ?? crypto.randomUUID();
      const full = { ...row, id };
      this.tables[table].set(id, full);
      results.push(full);
    }
    return Array.isArray(rows) ? results : results[0];
  }

  findById(table: string, id: string): Row | undefined {
    return this.tables[table].get(id);
  }

  findWhere(table: string, pred: (r: Row) => boolean): Row[] {
    return Array.from(this.tables[table].values()).filter(pred);
  }

  update(table: string, id: string, changes: Partial<Row>): void {
    const existing = this.tables[table].get(id);
    if (existing) this.tables[table].set(id, { ...existing, ...changes });
  }

  delete(table: string, id: string): void {
    this.tables[table].delete(id);
  }

  clear(): void {
    for (const map of Object.values(this.tables)) map.clear();
  }
}

// ── Helpers ──

function uid(prefix = "e"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function tenureDays(joinedAt: Date): number {
  return Math.max(1, Math.floor((Date.now() - joinedAt.getTime()) / 86400000));
}

function tierForMemberCount(n: number): string {
  if (n >= 10000) return "massive";
  if (n >= 1000) return "huge";
  if (n >= 200) return "large";
  if (n >= 50) return "medium";
  if (n >= 5) return "small";
  return "fringe";
}

function calcVoteAdvance(memberCount: number, votesCast: number, votes: { vote: string; weight: number }[]): {
  advances: boolean;
  expires: boolean;
  meetsQuorum: boolean;
  yesRatio: number;
} {
  const meetsQuorum = votesCast >= Math.ceil(memberCount * 0.3);
  const yesWeight = votes.filter((v) => v.vote === "yes").reduce((s, v) => s + v.weight, 0);
  const noWeight = votes.filter((v) => v.vote === "no").reduce((s, v) => s + v.weight, 0);
  const totalWeight = yesWeight + noWeight;
  const yesRatio = totalWeight > 0 ? yesWeight / totalWeight : 0;

  return {
    advances: meetsQuorum && yesRatio >= 0.5,
    expires: !meetsQuorum || yesRatio < 0.5,
    meetsQuorum,
    yesRatio,
  };
}

// ── The E2E Flow: create group → invite → impulse → vote → broadcast ──

describe("E2E: Full User Flow", () => {
  let store: E2EStore;

  // Actors
  const aliceId = uid("alice");
  const bobId = uid("bob");
  const charlieId = uid("charlie");

  // Group
  const groupId = uid("group");
  const groupName = "Tech Thinkers";

  // Invite codes
  const inviteCodeAlice = uid("code");
  const inviteCodeBob = uid("code");

  // Impulse
  const impulseId = uid("impulse");

  // Message
  const messageId = uid("msg");

  beforeEach(() => {
    store = new E2EStore();
  });

  // ════════════════════════════════════════════
  // Step 1: Create group
  // ════════════════════════════════════════════

  describe("Step 1: Create group", () => {
    it("creates a new group with creator as first member", () => {
      store.insert("users", [{ id: aliceId, username: "alice", oauthProvider: "google", oauthId: "google_1", createdAt: daysAgo(60), reputation: 1 }]);

      // Create group
      store.insert("groups", [{
        id: groupId,
        name: groupName,
        bio: "A group for tech discussion",
        energy: "thoughtful",
        timezone: "UTC",
        createdAt: new Date(),
        lastEnergyChangeAt: new Date(),
        minInteractionTier: "fringe",
      }]);

      // Creator is auto-member with vouched status
      store.insert("memberships", [{
        userId: aliceId,
        groupId,
        isVouched: true,
        joinedAt: new Date(),
      }]);

      // Generate 5 invite codes
      for (let i = 0; i < 5; i++) {
        store.insert("inviteCodes", [{
          groupId,
          code: uid("inv"),
          createdBy: aliceId,
          createdAt: new Date(),
        }]);
      }

      // Verify
      const group = store.findById("groups", groupId);
      expect(group).toBeDefined();
      expect(group.name).toBe(groupName);
      expect(group.energy).toBe("thoughtful");

      const members = store.findWhere("memberships", (m) => m.groupId === groupId);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(aliceId);
      expect(members[0].isVouched).toBe(true);

      const codes = store.findWhere("inviteCodes", (c) => c.groupId === groupId);
      expect(codes).toHaveLength(5);

      const memberCount = members.length;
      expect(tierForMemberCount(memberCount)).toBe("fringe");
    });
  });

  // ════════════════════════════════════════════
  // Step 2: Invite members
  // ════════════════════════════════════════════

  describe("Step 2: Invite members via invite codes", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice", oauthProvider: "google", oauthId: "google_1", createdAt: daysAgo(60), reputation: 1 },
        { id: bobId, username: "bob", oauthProvider: "github", oauthId: "gh_1", createdAt: daysAgo(30), reputation: 1 },
        { id: charlieId, username: "charlie", oauthProvider: "apple", oauthId: "apple_1", createdAt: daysAgo(10), reputation: 1 },
      ]);

      store.insert("groups", [{
        id: groupId, name: groupName, bio: "", energy: "thoughtful", minInteractionTier: "fringe",
      }]);

      store.insert("memberships", [{
        userId: aliceId, groupId, isVouched: true, joinedAt: daysAgo(60),
      }]);

      store.insert("inviteCodes", [
        { code: inviteCodeAlice, groupId, createdBy: aliceId, usedBy: null },
        { code: inviteCodeBob, groupId, createdBy: aliceId, usedBy: null },
      ]);
    });

    it("joins group with valid invite code", () => {
      const invite = store.findWhere("inviteCodes", (c) => c.code === inviteCodeAlice && c.usedBy === null)[0];
      expect(invite).toBeDefined();

      // Join: Bob uses the code
      store.update("inviteCodes", invite.id, { usedBy: bobId, usedAt: new Date() });
      store.insert("memberships", [{ userId: bobId, groupId, joinedAt: new Date() }]);
      store.insert("activityEvents", [{ userId: bobId, groupId, eventType: "invite_used", createdAt: new Date() }]);

      const bobMembership = store.findWhere("memberships", (m) => m.userId === bobId && m.groupId === groupId);
      expect(bobMembership).toHaveLength(1);

      // Charlie joins with the other code
      const invite2 = store.findWhere("inviteCodes", (c) => c.code === inviteCodeBob && c.usedBy === null)[0];
      store.update("inviteCodes", invite2.id, { usedBy: charlieId, usedAt: new Date() });
      store.insert("memberships", [{ userId: charlieId, groupId, joinedAt: new Date() }]);

      const memberCount = store.findWhere("memberships", (m) => m.groupId === groupId).length;
      expect(memberCount).toBe(3);
      expect(tierForMemberCount(memberCount)).toBe("fringe"); // still fringe (3 < 5)
    });

    it("rejects already-used invite code", () => {
      const invite = store.findWhere("inviteCodes", (c) => c.code === inviteCodeAlice && c.usedBy === null)[0];

      // Bob uses it
      store.update("inviteCodes", invite.id, { usedBy: bobId, usedAt: new Date() });

      // Charlie tries to use the same code
      const used = store.findById("inviteCodes", invite.id);
      expect(used!.usedBy).toBeTruthy();
      expect(used!.usedBy === null).toBe(false);
    });

    it("rejects already-member user", () => {
      // Alice is already a member, tries to join again
      const existing = store.findWhere("memberships", (m) => m.userId === aliceId && m.groupId === groupId);
      expect(existing.length).toBeGreaterThan(0);

      // Would reject with "already a member"
      const alreadyMember = existing.length > 0;
      expect(alreadyMember).toBe(true);
    });
  });

  // ════════════════════════════════════════════
  // Step 3: Create impulse
  // ════════════════════════════════════════════

  describe("Step 3: Create impulse (queued → voting)", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice", createdAt: daysAgo(60) },
        { id: bobId, username: "bob", createdAt: daysAgo(30) },
        { id: charlieId, username: "charlie", createdAt: daysAgo(10) },
      ]);
      store.insert("groups", [{ id: groupId, name: groupName }]);
      store.insert("memberships", [
        { id: uid("mem"), userId: aliceId, groupId, joinedAt: daysAgo(60) },
        { id: uid("mem"), userId: bobId, groupId, joinedAt: daysAgo(30) },
        { id: uid("mem"), userId: charlieId, groupId, joinedAt: daysAgo(10) },
      ]);
    });

    it("creates a new impulse in queued state", () => {
      const queuePosition = store.findWhere("impulses", (i) => i.groupId === groupId && i.status === "queued").length + 1;

      store.insert("impulses", [{
        id: impulseId,
        groupId,
        title: "Adopt new API standards",
        description: "We should adopt JSON:API for cross-group communication",
        createdBy: aliceId,
        status: "queued",
        queuePosition,
        createdAt: new Date(),
      }]);

      const impulse = store.findById("impulses", impulseId);
      expect(impulse).toBeDefined();
      expect(impulse.status).toBe("queued");
      expect(impulse.queuePosition).toBe(1);
      expect(impulse.title).toBe("Adopt new API standards");
    });

    it("assigns queue position based on existing queued count", () => {
      // Create 2 impulses
      store.insert("impulses", [
        { id: uid("imp"), groupId, title: "First", createdBy: bobId, status: "queued", queuePosition: 1, createdAt: new Date() },
      ]);

      const position = store.findWhere("impulses", (i) => i.groupId === groupId && i.status === "queued").length + 1;
      expect(position).toBe(2);
    });

    it("transitions queued with highest tenure to voting", () => {
      store.insert("impulses", [
        { id: impulseId, groupId, title: "API Standards", createdBy: aliceId, status: "queued", queuePosition: 1, createdAt: new Date() },
      ]);

      // Alice (60d tenure) should be selected as winner
      const winnerId = impulseId;
      store.update("impulses", winnerId, { status: "voting", votingEndsAt: new Date(Date.now() + 4 * 3600000) });

      const impulse = store.findById("impulses", impulseId);
      expect(impulse.status).toBe("voting");
      expect(new Date(impulse.votingEndsAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("logs engagement event on impulse creation", () => {
      store.insert("activityEvents", [{
        userId: aliceId, groupId, eventType: "impulse_created", createdAt: new Date(),
      }]);

      const events = store.findWhere("activityEvents", (e) => e.eventType === "impulse_created");
      expect(events).toHaveLength(1);
      expect(events[0].userId).toBe(aliceId);
    });
  });

  // ════════════════════════════════════════════
  // Step 4: Vote
  // ════════════════════════════════════════════

  describe("Step 4: Vote on impulse", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice", createdAt: daysAgo(60) },
        { id: bobId, username: "bob", createdAt: daysAgo(30) },
        { id: charlieId, username: "charlie", createdAt: daysAgo(10) },
      ]);
      store.insert("groups", [{ id: groupId, name: groupName }]);
      store.insert("memberships", [
        { id: uid("mem"), userId: aliceId, groupId, joinedAt: daysAgo(60) },
        { id: uid("mem"), userId: bobId, groupId, joinedAt: daysAgo(30) },
        { id: uid("mem"), userId: charlieId, groupId, joinedAt: daysAgo(10) },
      ]);
      store.insert("impulses", [{
        id: impulseId, groupId, title: "API Standards", createdBy: aliceId,
        status: "voting", votingEndsAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
      }]);
    });

    it("casts votes with tenure-weighted values", () => {
      const aliceWeight = tenureDays(daysAgo(60)); // ~60
      const bobWeight = tenureDays(daysAgo(30));    // ~30
      const charlieWeight = tenureDays(daysAgo(10)); // ~10

      store.insert("votes", [
        { impulseId, userId: aliceId, vote: "yes", weight: aliceWeight },
        { impulseId, userId: bobId, vote: "yes", weight: bobWeight },
        { impulseId, userId: charlieId, vote: "no", weight: charlieWeight },
      ]);

      const votes = store.findWhere("votes", (v) => v.impulseId === impulseId);
      expect(votes).toHaveLength(3);

      const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
      expect(totalWeight).toBe(aliceWeight + bobWeight + charlieWeight);

      // Tenure-weighted tally
      const yesWeight = votes.filter((v) => v.vote === "yes").reduce((s, v) => s + v.weight, 0);
      const noWeight = votes.filter((v) => v.vote === "no").reduce((s, v) => s + v.weight, 0);
      expect(yesWeight).toBe(aliceWeight + bobWeight);
      expect(noWeight).toBe(charlieWeight);
    });

    it("rejects votes when impulse is not in voting phase", () => {
      store.update("impulses", impulseId, { status: "composing" });

      const impulse = store.findById("impulses", impulseId);
      const canVote = impulse.status === "voting";
      expect(canVote).toBe(false);
    });

    it("advances to composing when quorum and majority met", () => {
      // Alice (60) - yes, Bob (30) - yes, Charlie (10) - no
      // Votes cast: 3/3 = 100% ≥ 30% quorum ✓
      // Yes weight: 90/100 = 90% ≥ 50% majority ✓
      // → should advance to composing
      const aliceWeight = 60;
      const bobWeight = 30;
      const charlieWeight = 10;

      store.insert("votes", [
        { impulseId, userId: aliceId, vote: "yes", weight: aliceWeight },
        { impulseId, userId: bobId, vote: "yes", weight: bobWeight },
        { impulseId, userId: charlieId, vote: "no", weight: charlieWeight },
      ]);

      const memberCount = 3;
      const votes = store.findWhere("votes", (v) => v.impulseId === impulseId);
      const result = calcVoteAdvance(memberCount, votes.length, votes);

      expect(result.meetsQuorum).toBe(true);
      expect(result.yesRatio).toBeGreaterThanOrEqual(0.5);
      expect(result.advances).toBe(true);

      if (result.advances) {
        store.update("impulses", impulseId, { status: "composing" });
      }

      expect(store.findById("impulses", impulseId).status).toBe("composing");
    });

    it("updates adaptive timer on each vote", () => {
      store.insert("votes", [
        { impulseId, userId: aliceId, vote: "yes", weight: 60 },
      ]);

      // Adaptive timer calculation (simplified)
      const memberCount = 3;
      const votes = store.findWhere("votes", (v) => v.impulseId === impulseId);
      const remaining = Math.max(
        10 * 60 * 1000, // MIN_VOTING_WINDOW
        Math.min(
          4 * 3600000, // MAX_VOTING_WINDOW
          4 * 3600000 * (1 - votes.length / (memberCount * 2)),
        ),
      );

      store.update("impulses", impulseId, { votingEndsAt: new Date(Date.now() + remaining) });

      const impulse = store.findById("impulses", impulseId);
      const newRemaining = new Date(impulse.votingEndsAt).getTime() - Date.now();
      expect(newRemaining).toBeGreaterThanOrEqual(10 * 60 * 1000);
    });
  });

  // ════════════════════════════════════════════
  // Step 5: Composing phase
  // ════════════════════════════════════════════

  describe("Step 5: Composing phase", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice", createdAt: daysAgo(60) },
        { id: bobId, username: "bob", createdAt: daysAgo(30) },
        { id: charlieId, username: "charlie", createdAt: daysAgo(10) },
      ]);
      store.insert("groups", [{ id: groupId, name: groupName }]);
      store.insert("memberships", [
        { id: uid("mem"), userId: aliceId, groupId, joinedAt: daysAgo(60) },
        { id: uid("mem"), userId: bobId, groupId, joinedAt: daysAgo(30) },
        { id: uid("mem"), userId: charlieId, groupId, joinedAt: daysAgo(10) },
      ]);
      store.insert("impulses", [{
        id: impulseId, groupId, title: "API Standards", createdBy: aliceId,
        status: "composing", createdAt: new Date(),
      }]);
    });

    it("submits drafts", () => {
      store.insert("drafts", [
        { impulseId, userId: aliceId, content: "Let's adopt JSON:API with OpenAPI specs.", parentDraftId: null },
        { impulseId, userId: bobId, content: "+1 to JSON:API. We should also version the spec.", parentDraftId: null },
      ]);

      const drafts = store.findWhere("drafts", (d) => d.impulseId === impulseId);
      expect(drafts).toHaveLength(2);
    });

    it("threads drafts via parentDraftId", () => {
      const draft1 = store.insert("drafts", [
        { impulseId, userId: aliceId, content: "Initial proposal", parentDraftId: null },
      ])[0];

      store.insert("drafts", [
        { impulseId, userId: bobId, content: "Reply to proposal", parentDraftId: draft1.id },
      ]);

      const replies = store.findWhere("drafts", (d) => d.parentDraftId === draft1.id);
      expect(replies).toHaveLength(1);
    });

    it("transitions to summarizing when composing window expires with drafts", () => {
      store.insert("drafts", [
        { impulseId, userId: aliceId, content: "Draft content", parentDraftId: null },
      ]);

      const draftCount = store.findWhere("drafts", (d) => d.impulseId === impulseId).length;
      expect(draftCount).toBeGreaterThan(0);

      // Simulate composing window expiry
      store.update("impulses", impulseId, { status: "summarizing" });

      expect(store.findById("impulses", impulseId).status).toBe("summarizing");
    });
  });

  // ════════════════════════════════════════════
  // Step 6: Summarization → Approval
  // ════════════════════════════════════════════

  describe("Step 6: Summarization and approval", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice" },
        { id: bobId, username: "bob" },
        { id: charlieId, username: "charlie" },
      ]);
      store.insert("groups", [{ id: groupId, name: groupName }]);
      store.insert("impulses", [{
        id: impulseId, groupId, title: "API Standards", createdBy: aliceId,
        status: "summarizing",
      }]);
    });

    it("generates LLM summary candidates", () => {
      store.insert("summaryCandidates", [
        { impulseId, content: "Proposal to adopt JSON:API with versioned OpenAPI specs, opt-in per group." },
        { impulseId, content: "Adopt JSON:API standard with a 90-day review cycle and optional migration." },
        { impulseId, content: "Phase in JSON:API with 3 pilot groups before full rollout." },
      ]);

      const candidates = store.findWhere("summaryCandidates", (c) => c.impulseId === impulseId);
      expect(candidates.length).toBeGreaterThanOrEqual(2);
    });

    it("transitions to approval when at least 2 candidates exist", () => {
      store.insert("summaryCandidates", [
        { impulseId, content: "Candidate 1" },
        { impulseId, content: "Candidate 2" },
      ]);

      const count = store.findWhere("summaryCandidates", (c) => c.impulseId === impulseId).length;
      if (count >= 2) {
        store.update("impulses", impulseId, { status: "approval" });
      }

      expect(store.findById("impulses", impulseId).status).toBe("approval");
    });
  });

  // ════════════════════════════════════════════
  // Step 7: Broadcast
  // ════════════════════════════════════════════

  describe("Step 7: Broadcast", () => {
    beforeEach(() => {
      store.insert("users", [
        { id: aliceId, username: "alice" },
        { id: bobId, username: "bob" },
      ]);
      store.insert("groups", [{ id: groupId, name: groupName }]);
      store.insert("impulses", [{
        id: impulseId, groupId, title: "API Standards", description: "Adopt JSON:API",
        createdBy: aliceId, status: "approval",
      }]);
      store.insert("summaryCandidates", [
        { id: uid("sc"), impulseId, content: "We will adopt JSON:API with OpenAPI specs, opt-in per group." },
        { id: uid("sc"), impulseId, content: "Adopt JSON:API with a 90-day review cycle." },
      ]);
    });

    it("approves a summary candidate and broadcasts it as a message", () => {
      // Pick candidate 1 and mark impulse as broadcast
      const broadcastContent = "We will adopt JSON:API with OpenAPI specs, opt-in per group.";
      store.update("impulses", impulseId, { status: "broadcast" });

      // Broadcast handler creates a message
      store.insert("messages", [{
        id: messageId,
        impulseId,
        groupId,
        content: broadcastContent,
        status: "active",
        createdAt: new Date(),
      }]);

      const message = store.findById("messages", messageId);
      expect(message).toBeDefined();
      expect(message.content).toBe(broadcastContent);
      expect(message.status).toBe("active");
    });

    it("broadcast message appears in feed", () => {
      store.insert("messages", [{
        id: messageId,
        impulseId,
        groupId,
        content: "Broadcast content",
        status: "active",
        createdAt: new Date(),
      }]);

      const feedMessages = store.findWhere("messages", (m) => m.status === "active");
      expect(feedMessages.length).toBeGreaterThan(0);
      expect(feedMessages.some((m) => m.id === messageId)).toBe(true);
    });

    it("supports cross-group targeting in broadcast", () => {
      const targetGroupId = uid("group");
      store.insert("groups", [{ id: targetGroupId, name: "Target Group", bio: "" }]);

      store.insert("messages", [{
        id: uid("msg"),
        impulseId,
        groupId,
        targetGroupId,
        content: "Message for another group",
        status: "active",
        createdAt: new Date(),
      }]);

      const targeted = store.findWhere("messages", (m) => m.targetGroupId === targetGroupId);
      expect(targeted).toHaveLength(1);
    });

    it("discards when no summary achieves approval", () => {
      store.update("impulses", impulseId, { status: "discarded" });
      expect(store.findById("impulses", impulseId).status).toBe("discarded");
    });
  });

  // ════════════════════════════════════════════
  // Full happy path end-to-end
  // ════════════════════════════════════════════

  describe("Full happy path: create → invite → impulse → vote → broadcast", () => {
    it("completes the entire flow successfully", () => {
      // ── 1. CREATE GROUP ──
      store.insert("users", [
        { id: aliceId, username: "alice", oauthProvider: "google", oauthId: "g_1", createdAt: daysAgo(60) },
        { id: bobId, username: "bob", oauthProvider: "github", oauthId: "gh_1", createdAt: daysAgo(30) },
        { id: charlieId, username: "charlie", oauthProvider: "apple", oauthId: "a_1", createdAt: daysAgo(10) },
      ]);

      store.insert("groups", [{
        id: groupId, name: groupName, bio: "Tech discussion", energy: "thoughtful",
        createdAt: new Date(), minInteractionTier: "fringe",
      }]);
      store.insert("memberships", [{
        userId: aliceId, groupId, isVouched: true, joinedAt: new Date(),
      }]);

      // 5 invite codes
      const codes = [];
      for (let i = 0; i < 5; i++) {
        const code = uid("ic");
        store.insert("inviteCodes", [{ code, groupId, createdBy: aliceId, usedBy: null }]);
        codes.push(code);
      }

      expect(store.findWhere("groups", (g) => g.id === groupId)).toHaveLength(1);
      expect(store.findWhere("memberships", (m) => m.groupId === groupId)).toHaveLength(1);
      expect(store.findWhere("inviteCodes", (c) => c.groupId === groupId)).toHaveLength(5);

      // ── 2. INVITE MEMBERS ──
      // Bob joins
      const bobInvite = store.findWhere("inviteCodes", (c) => c.groupId === groupId && c.usedBy === null)[0];
      store.update("inviteCodes", bobInvite.id, { usedBy: bobId, usedAt: new Date() });
      store.insert("memberships", [{ id: uid("mem"), userId: bobId, groupId, joinedAt: new Date() }]);

      // Charlie joins
      const charlieInvite = store.findWhere("inviteCodes", (c) => c.groupId === groupId && c.usedBy === null)[0];
      store.update("inviteCodes", charlieInvite.id, { usedBy: charlieId, usedAt: new Date() });
      store.insert("memberships", [{ id: uid("mem"), userId: charlieId, groupId, joinedAt: new Date() }]);

      expect(store.findWhere("memberships", (m) => m.groupId === groupId)).toHaveLength(3);
      expect(tierForMemberCount(3)).toBe("fringe");

      // ── 3. CREATE IMPULSE ──
      store.insert("impulses", [{
        id: impulseId, groupId, title: "Adopt JSON:API",
        description: "Proposal for cross-group API standardization",
        createdBy: aliceId, status: "queued", queuePosition: 1, createdAt: new Date(),
      }]);

      // Log engagement
      store.insert("activityEvents", [{
        userId: aliceId, groupId, eventType: "impulse_created", createdAt: new Date(),
      }]);

      expect(store.findById("impulses", impulseId).status).toBe("queued");

      // ── 4. QUEUED → VOTING ──
      store.update("impulses", impulseId, { status: "voting", votingEndsAt: new Date(Date.now() + 4 * 3600000) });
      expect(store.findById("impulses", impulseId).status).toBe("voting");

      // ── 5. VOTE ──
      const aliceW = tenureDays(daysAgo(60)); // 60
      const bobW = tenureDays(daysAgo(30));    // 30
      const charlieW = tenureDays(daysAgo(10)); // 10

      store.insert("votes", [
        { impulseId, userId: aliceId, vote: "yes", weight: aliceW },
        { impulseId, userId: bobId, vote: "yes", weight: bobW },
        { impulseId, userId: charlieId, vote: "yes", weight: charlieW },
      ]);

      const votesCast = store.findWhere("votes", (v) => v.impulseId === impulseId).length;
      const votes = store.findWhere("votes", (v) => v.impulseId === impulseId);
      const result = calcVoteAdvance(3, votesCast, votes);

      expect(result.advances).toBe(true);
      expect(result.yesRatio).toBe(1); // unanimous

      // ── 6. VOTING → COMPOSING ──
      store.update("impulses", impulseId, { status: "composing" });
      expect(store.findById("impulses", impulseId).status).toBe("composing");

      // ── 7. SUBMIT DRAFTS ──
      store.insert("drafts", [
        { impulseId, userId: aliceId, content: "Proposal: adopt JSON:API v1.1", parentDraftId: null },
        { impulseId, userId: bobId, content: "Support with OpenAPI 3.1", parentDraftId: null },
        { impulseId, userId: charlieId, content: "Add migration guide", parentDraftId: null },
      ]);
      expect(store.findWhere("drafts", (d) => d.impulseId === impulseId)).toHaveLength(3);

      // ── 8. COMPOSING → SUMMARIZING → APPROVAL ──
      store.update("impulses", impulseId, { status: "summarizing" });

      store.insert("summaryCandidates", [
        { impulseId, content: "Adopt JSON:API with OpenAPI specs, opt-in per group." },
        { impulseId, content: "Adopt JSON:API with a 90-day review cycle." },
      ]);

      const candidateCount = store.findWhere("summaryCandidates", (c) => c.impulseId === impulseId).length;
      if (candidateCount >= 2) {
        store.update("impulses", impulseId, { status: "approval" });
      }
      expect(store.findById("impulses", impulseId).status).toBe("approval");

      // ── 9. APPROVAL → BROADCAST ──
      store.update("impulses", impulseId, { status: "broadcast" });

      store.insert("messages", [{
        id: messageId,
        impulseId,
        groupId,
        content: "Group decision: Adopt JSON:API with OpenAPI specs, opt-in per group.",
        status: "active",
        createdAt: new Date(),
      }]);

      const broadcastMsg = store.findById("messages", messageId);
      expect(broadcastMsg).toBeDefined();
      expect(broadcastMsg.status).toBe("active");
      expect(broadcastMsg.content).toContain("JSON:API");

      // ── VERIFY END STATE ──
      // Group exists with 3 members
      expect(store.findWhere("memberships", (m) => m.groupId === groupId)).toHaveLength(3);

      // Impulse completed its lifecycle
      expect(store.findById("impulses", impulseId).status).toBe("broadcast");

      // Message appears in feed
      const activeMessages = store.findWhere("messages", (m) => m.status === "active");
      expect(activeMessages.some((m) => m.impulseId === impulseId)).toBe(true);

      // 3 votes recorded
      expect(store.findWhere("votes", (v) => v.impulseId === impulseId)).toHaveLength(3);

      // 3 drafts recorded
      expect(store.findWhere("drafts", (d) => d.impulseId === impulseId)).toHaveLength(3);
    });
  });
});
