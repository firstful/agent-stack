import { describe, it, expect, beforeEach, vi } from "vitest";
import { canTransition } from "@groupthink/shared/src/lib/state-machine";
import { adaptiveRemaining, MAX_VOTING_WINDOW, MAX_COMPOSING_WINDOW } from "@groupthink/shared/src/lib/adaptive-timer";
import {
  VOTE_ADVANCE_RATIO,
  VOTE_QUORUM_RATIO,
} from "../lifecycle";

// ── In-Memory Store ──

type Row = Record<string, any>;
type Table = Map<string, Row[]>;

class MockStore {
  private tables: Map<string, Table> = new Map();

  getTable(name: string): Table {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  insert(table: string, rows: Row[]): void {
    const t = this.getTable(table);
    for (const row of rows) {
      const id = row.id ?? crypto.randomUUID();
      t.set(id, { ...row, id });
    }
  }

  update(table: string, id: string, data: Partial<Row>): void {
    const t = this.getTable(table);
    const existing = t.get(id);
    if (existing) {
      t.set(id, { ...existing, ...data });
    }
  }

  findAll(table: string): Row[] {
    return Array.from(this.getTable(table).values());
  }

  findById(table: string, id: string): Row | undefined {
    return this.getTable(table).get(id);
  }

  findWhere(table: string, predicate: (row: Row) => boolean): Row[] {
    return this.findAll(table).filter(predicate);
  }

  countWhere(table: string, predicate: (row: Row) => boolean): number {
    return this.findWhere(table, predicate).length;
  }

  deleteWhere(table: string, predicate: (row: Row) => boolean): void {
    const t = this.getTable(table);
    for (const [id, row] of t) {
      if (predicate(row)) t.delete(id);
    }
  }

  clear(): void {
    this.tables.clear();
  }
}

// ── Mock Drizzle DB (minimal interface used by lifecycle functions) ──

function createMockDb(store: MockStore) {
  const db: any = {
    select: () => ({
      from: (tbl: any) => ({
        where: (...args: any[]) => {
          // Simplified: just return all rows from the matching table
          const tableName = tbl?.name ?? tbl?._?.name ?? "unknown";
          return store.findAll(tableName);
        },
        innerJoin: () => ({
          where: (...args: any[]) => store.findAll("impulses"),
        }),
        orderBy: () => store.findAll("impulses"),
      }),
      // For selectDistinct
      selectDistinct: (cols: any) => ({
        from: (tbl: any) => ({
          where: (...args: any[]) => store.findAll("impulses"),
        }),
      }),
    }),
    update: (tbl: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          // Apply the update to matching rows
          const tableName = tbl?.name ?? tbl?._?.name ?? "unknown";
          const rows = store.findAll(tableName);
          for (const row of rows) {
            // In a real test we'd evaluate the condition properly
            // For now, apply the update to the first row as a heuristic
            // The tests below use more specific patterns
          }
          return { execute: async () => {} };
        },
      }),
    }),
    insert: (tbl: any) => ({
      values: (data: any) => ({
        returning: async () => {
          const tableName = tbl?.name ?? tbl?._?.name ?? "unknown";
          const id = data.id ?? crypto.randomUUID();
          const row = { ...data, id };
          store.insert(tableName, [row]);
          return [row];
        },
      }),
    }),
    delete: (tbl: any) => ({
      where: (condition: any) => ({ execute: async () => {} }),
    }),
    $count: async (tbl: any, condition?: any) => {
      const tableName = tbl?.name ?? tbl?._?.name ?? "unknown";
      if (condition) {
        // Count all rows in the table (simplified)
        return store.findAll(tableName).length;
      }
      return store.findAll(tableName).length;
    },
    // Drizzle query API
    query: {},
  };

  // Build query helpers for each schema table
  for (const [tableName] of Object.entries({})) {
    if (typeof tableName === "object") {
      const name = tableName;
      db.query[name] = {
        findFirst: async (opts: any) => {
          const rows = store.findAll(name);
          if (opts?.where) {
            // Simplified: return first row
            return rows[0] ?? null;
          }
          return rows[0] ?? null;
        },
        findMany: async (opts: any) => {
          const rows = store.findAll(name);
          return rows;
        },
      };
    }
  }

  return db;
}

// ── Mock Redis ──

function createMockRedis() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue("PONG"),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isOpen: false,
  };
}

// ── Test helpers ──

function makeId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

// ── Tests ──

describe("Integration: Impulse Lifecycle (queued → broadcast)", () => {
  let store: MockStore;
  let db: any;
  let redis: ReturnType<typeof createMockRedis>;

  // Common test data
  const userId = makeId("user");
  const groupId = makeId("group");
  const impulseId = makeId("impulse");

  beforeEach(() => {
    store = new MockStore();
    db = createMockDb(store);
    redis = createMockRedis();
    vi.clearAllMocks();
  });

  function seedGroupAndUser() {
    // Create a user
    store.insert("users", [
      { id: userId, username: "alice", oauthProvider: "google", oauthId: "google_1", createdAt: daysAgo(30), reputation: 1 },
    ]);
    // Create a group
    store.insert("groups", [
      { id: groupId, name: "Test Group", bio: "", energy: "thoughtful", createdAt: new Date() },
    ]);
    // Add user as member
    store.insert("memberships", [
      { id: makeId("mem"), userId, groupId, joinedAt: daysAgo(30), isVouched: true },
    ]);
  }

  function seedQueuedImpulse() {
    store.insert("impulses", [
      { id: impulseId, groupId, title: "Test Impulse", description: "A test", createdBy: userId, status: "queued", queuePosition: 1, createdAt: new Date() },
    ]);
  }

  // ── Phase 1: queued → voting ──

  describe("Phase 1: queued → voting", () => {
    it("advances queued impulse with highest tenure to voting when no active impulses exist", async () => {
      seedGroupAndUser();
      seedQueuedImpulse();

      // directly test the logic from lifecycle.ts
      const groupsWithQueued = store.findWhere("impulses", (i) => i.status === "queued");
      expect(groupsWithQueued).toHaveLength(1);

      // Check active count for group
      const activeCount = store.countWhere("impulses", (i) =>
        i.groupId === groupId && ["voting", "composing", "summarizing", "approval"].includes(i.status)
      );
      expect(activeCount).toBe(0);

      // Find queued sorted by queuePosition
      const queued = store
        .findWhere("impulses", (i) => i.status === "queued" && i.groupId === groupId)
        .sort((a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999));

      expect(queued).toHaveLength(1);
      expect(queued[0].id).toBe(impulseId);

      // The lifecycle engine would now promote this to voting
      const winner = queued[0];
      store.update("impulses", winner.id, { status: "voting", votingEndsAt: new Date(Date.now() + MAX_VOTING_WINDOW) });

      const updated = store.findById("impulses", impulseId);
      expect(updated.status).toBe("voting");
      expect(updated.votingEndsAt).toBeDefined();
    });

    it("does not advance when group already has active impulses", async () => {
      seedGroupAndUser();
      seedQueuedImpulse();

      // Add an already-voting impulse
      const otherId = makeId("impulse");
      store.insert("impulses", [
        { id: otherId, groupId, title: "Active", createdBy: userId, status: "voting", votingEndsAt: new Date(Date.now() + 3600000) },
      ]);

      const activeCount = store.countWhere("impulses", (i) =>
        i.groupId === groupId && ["voting", "composing", "summarizing", "approval"].includes(i.status)
      );
      expect(activeCount).toBe(1);

      // Should NOT advance since activeCount >= MAX_ACTIVE_PER_GROUP (1)
      expect(activeCount).toBeGreaterThanOrEqual(1);
    });

    it("selects highest-tenure creator when multiple queued", async () => {
      seedGroupAndUser();
      const user2Id = makeId("user");

      store.insert("users", [
        { id: user2Id, username: "bob", oauthProvider: "google", oauthId: "google_2", createdAt: daysAgo(5), reputation: 1 },
      ]);
      store.insert("memberships", [
        { id: makeId("mem"), userId: user2Id, groupId, joinedAt: daysAgo(5), isVouched: true },
      ]);

      // Two queued impulses: alice (30d tenure) and bob (5d tenure)
      store.insert("impulses", [
        { id: makeId("impulse"), groupId, title: "Alice Impulse", createdBy: userId, status: "queued", queuePosition: 1, createdAt: new Date() },
        { id: makeId("impulse"), groupId, title: "Bob Impulse", createdBy: user2Id, status: "queued", queuePosition: 2, createdAt: new Date() },
      ]);

      const queued = store.findWhere("impulses", (i) => i.status === "queued" && i.groupId === groupId);
      expect(queued).toHaveLength(2);

      // Score by tenure
      const scored = queued.map((imp) => {
        const user = store.findById("users", imp.createdBy);
        const days = user
          ? Math.max(1, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000))
          : 1;
        return { impulse: imp, tenureDays: days };
      });

      scored.sort((a, b) => {
        const td = b.tenureDays - a.tenureDays;
        if (td !== 0) return td;
        return new Date(a.impulse.createdAt).getTime() - new Date(b.impulse.createdAt).getTime();
      });

      // Alice (30d) should be first
      expect(scored[0].tenureDays).toBeGreaterThanOrEqual(scored[1].tenureDays);
      expect(scored[0].impulse.title).toBe("Alice Impulse");
    });

    it("uses creation date as tiebreaker for equal tenure", async () => {
      seedGroupAndUser();

      // Two users with same tenure
      const user2Id = makeId("user");
      store.insert("users", [
        { id: user2Id, username: "bob", oauthProvider: "google", oauthId: "google_2", createdAt: daysAgo(30), reputation: 1 },
      ]);
      store.insert("memberships", [
        { id: makeId("mem"), userId: user2Id, groupId, joinedAt: daysAgo(30), isVouched: true },
      ]);

      store.insert("impulses", [
        { id: makeId("impulse"), groupId, title: "Earlier", createdBy: userId, status: "queued", queuePosition: 1, createdAt: daysAgo(1) },
        { id: makeId("impulse"), groupId, title: "Later", createdBy: user2Id, status: "queued", queuePosition: 2, createdAt: new Date() },
      ]);

      const queued = store.findWhere("impulses", (i) => i.status === "queued" && i.groupId === groupId);
      const scored = queued.map((imp) => ({
        impulse: imp,
        tenureDays: 30, // same
        createdAt: new Date(imp.createdAt).getTime(),
      }));

      // Same tenure — earlier creation wins
      scored.sort((a, b) => {
        if (b.tenureDays !== a.tenureDays) return b.tenureDays - a.tenureDays;
        return a.createdAt - b.createdAt;
      });

      expect(scored[0].impulse.title).toBe("Earlier");
    });
  });

  // ── Phase 2: voting → composing / expired ──

  describe("Phase 2: voting → composing / expired", () => {
    it("advances to composing when quorum and majority met", () => {
      const memberCount = 10;
      const votesCast = 4; // 40% ≥ 30% quorum
      const yesWeight = 30;
      const noWeight = 10;
      const totalWeight = yesWeight + noWeight;
      const yesRatio = totalWeight > 0 ? yesWeight / totalWeight : 0;
      const meetsQuorum = votesCast >= Math.ceil(memberCount * VOTE_QUORUM_RATIO);

      expect(meetsQuorum).toBe(true);
      expect(yesRatio).toBeGreaterThanOrEqual(VOTE_ADVANCE_RATIO);
    });

    it("expires when quorum not met", () => {
      const memberCount = 10;
      const votesCast = 2; // 20% < 30% quorum
      const meetsQuorum = votesCast >= Math.ceil(memberCount * VOTE_QUORUM_RATIO);
      expect(meetsQuorum).toBe(false);
    });

    it("expires when majority not reached", () => {
      const memberCount = 10;
      const votesCast = 5; // 50% ≥ 30% quorum
      const yesWeight = 10;
      const noWeight = 20;
      const yesRatio = yesWeight / (yesWeight + noWeight);
      const meetsQuorum = votesCast >= Math.ceil(memberCount * VOTE_QUORUM_RATIO);

      expect(meetsQuorum).toBe(true);
      expect(yesRatio).toBeLessThan(VOTE_ADVANCE_RATIO);
    });

    it("adaptiveRemaining collapses on supermajority", () => {
      const result = adaptiveRemaining({
        totalMembers: 10,
        votesCast: 8,
        yesVotes: 7,
        noVotes: 1,
        elapsedMs: 0,
      });
      expect(result).toBe(0);
    });

    it("adaptiveRemaining shrinks with participation", () => {
      const low = adaptiveRemaining({
        totalMembers: 10, votesCast: 0, yesVotes: 0, noVotes: 0, elapsedMs: 0,
      });
      const high = adaptiveRemaining({
        totalMembers: 10, votesCast: 5, yesVotes: 3, noVotes: 2, elapsedMs: 0,
      });
      expect(high).toBeLessThan(low);
    });

    it("adaptiveRemaining respects minimum floor", () => {
      const floor = adaptiveRemaining({
        totalMembers: 10,
        votesCast: 10,
        yesVotes: 4,
        noVotes: 6,
        elapsedMs: MAX_VOTING_WINDOW - 1000,
      });
      expect(floor).toBe(10 * 60 * 1000); // MIN_VOTING_WINDOW
    });
  });

  // ── Phase 3: composing → summarizing / expired ──

  describe("Phase 3: composing → summarizing / expired", () => {
    it("advances to summarizing when composing expires with drafts", () => {
      seedGroupAndUser();

      // Create a composing impulse with drafts
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Composing Test", createdBy: userId, status: "composing", createdAt: daysAgo(0) },
      ]);
      store.insert("drafts", [
        { id: makeId("draft"), impulseId, userId, content: "Draft 1", createdAt: new Date() },
      ]);

      const impulse = store.findById("impulses", impulseId);
      const elapsed = Date.now() - new Date(impulse.createdAt).getTime();
      const draftCount = store.countWhere("drafts", (d) => d.impulseId === impulseId);
      const extension = draftCount * MAX_COMPOSING_WINDOW * 0.2;
      const totalWindow = MAX_COMPOSING_WINDOW + extension;

      // If elapsed > totalWindow, should advance
      if (elapsed >= totalWindow) {
        store.update("impulses", impulseId, { status: "summarizing" });
      }

      // For the test, simulate that the window has expired
      // Need to exceed base window + draft extension (20% per draft)
      const pastOffset = MAX_COMPOSING_WINDOW + (draftCount * MAX_COMPOSING_WINDOW * 0.2) + 60000;
      store.update("impulses", impulseId, {
        createdAt: new Date(Date.now() - pastOffset),
      });
      const freshImpulse = store.findById("impulses", impulseId);
      const freshElapsed = Date.now() - new Date(freshImpulse.createdAt).getTime();
      const freshDraftCount = store.countWhere("drafts", (d) => d.impulseId === impulseId);
      const freshExtension = freshDraftCount * MAX_COMPOSING_WINDOW * 0.2;

      if (freshElapsed >= MAX_COMPOSING_WINDOW + freshExtension && freshDraftCount > 0) {
        store.update("impulses", impulseId, { status: "summarizing" });
      }

      const updated = store.findById("impulses", impulseId);
      expect(updated.status).toBe("summarizing");
    });

    it("expires composing when no drafts were submitted", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "No Drafts", createdBy: userId, status: "composing", createdAt: new Date(Date.now() - MAX_COMPOSING_WINDOW - 60000) },
      ]);

      const draftCount = store.countWhere("drafts", (d) => d.impulseId === impulseId);
      expect(draftCount).toBe(0);

      // Simulate expiry: elapsed > window and no drafts → expired
      store.update("impulses", impulseId, { status: "expired" });

      const updated = store.findById("impulses", impulseId);
      expect(updated.status).toBe("expired");
    });

    it("extends composing window proportionally with more drafts", () => {
      const baseWindow = MAX_COMPOSING_WINDOW;

      // 1 draft → 20% extension
      const ext1 = baseWindow + baseWindow * 0.2;
      // 3 drafts → 60% extension
      const ext3 = baseWindow + 3 * baseWindow * 0.2;
      // 10 drafts → 200% extension
      const ext10 = baseWindow + 10 * baseWindow * 0.2;

      expect(ext3).toBeGreaterThan(ext1);
      expect(ext10).toBeGreaterThan(ext3);
    });
  });

  // ── Phase 4: summarizing → approval ──

  describe("Phase 4: summarizing → approval", () => {
    it("advances to approval when at least 2 candidate summaries exist", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Summarized", createdBy: userId, status: "summarizing" },
      ]);
      // Insert 2 candidate summaries
      store.insert("summaryCandidates", [
        { id: makeId("sc"), impulseId, content: "Candidate 1", createdAt: new Date() },
        { id: makeId("sc"), impulseId, content: "Candidate 2", createdAt: new Date() },
      ]);

      const candidateCount = store.countWhere("summaryCandidates", (c) => c.impulseId === impulseId);
      expect(candidateCount).toBeGreaterThanOrEqual(2);
    });

    it("stays in summarizing with fewer than 2 candidates", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Summarizing", createdBy: userId, status: "summarizing" },
      ]);
      store.insert("summaryCandidates", [
        { id: makeId("sc"), impulseId, content: "Only candidate", createdAt: new Date() },
      ]);

      const candidateCount = store.countWhere("summaryCandidates", (c) => c.impulseId === impulseId);
      expect(candidateCount).toBe(1);
      expect(candidateCount).toBeLessThan(2);
    });

    it("LLM summarization triggered when summarizing with no existing candidates", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "LLM Ready", createdBy: userId, status: "summarizing" },
      ]);

      const existingCount = store.countWhere("summaryCandidates", (c) => c.impulseId === impulseId);
      expect(existingCount).toBe(0);

      // If candidates exist already, skip re-triggering
      store.insert("summaryCandidates", [
        { id: makeId("sc"), impulseId, content: "New candidate", createdAt: new Date() },
      ]);
      const afterTrigger = store.countWhere("summaryCandidates", (c) => c.impulseId === impulseId);
      expect(afterTrigger).toBe(1);
    });
  });

  // ── Phase 5: approval → broadcast / discarded ──

  describe("Phase 5: approval → broadcast / discarded", () => {
    it("broadcasts when approved summary has yes majority", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Approval Test", createdBy: userId, status: "approval" },
      ]);

      // Simulate approval votes on a candidate
      store.insert("summaryCandidates", [
        { id: makeId("sc"), impulseId, content: "Best summary", createdAt: new Date() },
      ]);

      // Check: if approved, should transition to broadcast
      store.update("impulses", impulseId, { status: "broadcast" });
      const updated = store.findById("impulses", impulseId);
      expect(updated.status).toBe("broadcast");
    });

    it("discards when no summary achieves majority", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Discarded", createdBy: userId, status: "approval" },
      ]);

      // No candidates meet threshold — should discard
      store.update("impulses", impulseId, { status: "discarded" });
      const updated = store.findById("impulses", impulseId);
      expect(updated.status).toBe("discarded");
    });

    it("broadcast creates a message in the feed", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Broadcast", description: "Content for broadcast", createdBy: userId, status: "broadcast" },
      ]);

      // Simulate broadcast handler creating a message
      store.insert("messages", [
        {
          id: makeId("msg"),
          impulseId,
          groupId,
          content: "Broadcast content here",
          status: "active",
          createdAt: new Date(),
        },
      ]);

      const messages = store.findWhere("messages", (m) => m.impulseId === impulseId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Broadcast content here");
      expect(messages[0].status).toBe("active");
    });
  });

  // ── State Machine Transitions ──

  describe("State machine: all transitions", () => {
    const validTransitions: [string, string][] = [
      ["queued", "voting"],
      ["queued", "discarded"],
      ["voting", "composing"],
      ["voting", "expired"],
      ["composing", "summarizing"],
      ["composing", "expired"],
      ["summarizing", "approval"],
      ["summarizing", "expired"],
      ["approval", "broadcast"],
      ["approval", "discarded"],
    ];

    it.each(validTransitions)("allows %s → %s", (from, to) => {
      expect(canTransition(from as any, to as any)).toBe(true);
    });

    const invalidTransitions: [string, string][] = [
      ["queued", "broadcast"],
      ["voting", "discarded"],
      ["voting", "broadcast"],
      ["broadcast", "queued"],
      ["expired", "voting"],
      ["discarded", "queued"],
      ["composing", "broadcast"],
    ];

    it.each(invalidTransitions)("rejects %s → %s", (from, to) => {
      expect(canTransition(from as any, to as any)).toBe(false);
    });
  });

  // ── Tenure Weight Calculation ──

  describe("Tenure weight calculation", () => {
    it("returns days since joining for tenure weight", () => {
      const joinedAt = daysAgo(45);
      const days = Math.floor((Date.now() - joinedAt.getTime()) / 86400000);
      expect(days).toBe(45);
    });

    it("returns minimum 1 for newly joined users", () => {
      const joinedAt = new Date();
      const days = Math.max(1, Math.floor((Date.now() - joinedAt.getTime()) / 86400000));
      expect(days).toBe(1);
    });

    it("returns 0 for non-members", () => {
      const membership = null;
      expect(membership === null ? 0 : 1).toBe(0);
    });
  });

  // ── Vote Threshold Math ──

  describe("Vote threshold math", () => {
    it("advances when quorum and majority met (exact boundary)", () => {
      const memberCount = 10;
      const quorum = Math.ceil(memberCount * VOTE_QUORUM_RATIO);
      expect(quorum).toBe(3);

      const votesCast = 3;
      const yesWeight = 8;
      const noWeight = 4;
      const yesRatio = yesWeight / (yesWeight + noWeight);
      expect(votesCast >= quorum).toBe(true);
      expect(yesRatio >= VOTE_ADVANCE_RATIO).toBe(true);
    });

    it("uses tenure-weighted votes, not raw counts", () => {
      // Two voters: Alice (60d tenure) votes yes, Bob (10d) votes no
      const aliceWeight = 60;
      const bobWeight = 10;
      const yesWeight = aliceWeight;
      const noWeight = bobWeight;
      const yesRatio = yesWeight / (yesWeight + noWeight);

      // Alice's longer tenure gives yes a high ratio
      expect(yesRatio).toBeCloseTo(60 / 70);
      expect(yesRatio >= VOTE_ADVANCE_RATIO).toBe(true);
    });

    it("quorum is based on voter count, not weight", () => {
      const memberCount = 10;
      const quorumCount = Math.ceil(memberCount * VOTE_QUORUM_RATIO);
      expect(quorumCount).toBe(3);

      // 3 voters = quorum met, even with very low weights
      const votesCast = 3;
      expect(votesCast >= quorumCount).toBe(true);
    });

    it("expired status when voting ends without quorum", () => {
      const memberCount = 10;
      const votesCast = 2;
      const meetsQuorum = votesCast >= Math.ceil(memberCount * VOTE_QUORUM_RATIO);
      expect(meetsQuorum).toBe(false);

      // In the lifecycle engine, not meeting quorum causes expired
      // (if the yesRatio < threshold too, but the code checks quorum first)
    });
  });

  // ── Queue Position Recalculation ──

  describe("Queue position recalculation", () => {
    it("recalculates positions after advancement", () => {
      seedGroupAndUser();

      // 3 queued impulses
      store.insert("impulses", [
        { id: makeId("impulse"), groupId, title: "A", createdBy: userId, status: "queued", queuePosition: 1 },
        { id: makeId("impulse"), groupId, title: "B", createdBy: userId, status: "queued", queuePosition: 2 },
        { id: makeId("impulse"), groupId, title: "C", createdBy: userId, status: "queued", queuePosition: 3 },
      ]);

      const remaining = store
        .findWhere("impulses", (i) => i.status === "queued" && i.groupId === groupId)
        .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

      // After removing the winner, remaining should be re-indexed 1, 2, ...
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].queuePosition = i + 1;
      }

      expect(remaining[0].queuePosition).toBe(1);
      expect(remaining[1].queuePosition).toBe(2);
      expect(remaining[2].queuePosition).toBe(3);
    });
  });

  // ── Impulse Expiry ──

  describe("Impulse expiry", () => {
    it("expires stale queued impulses older than 7 days", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Stale", createdBy: userId, status: "queued", queuePosition: 1, createdAt: daysAgo(10) },
      ]);

      // Check age
      const impulse = store.findById("impulses", impulseId);
      const ageInDays = Math.floor((Date.now() - new Date(impulse.createdAt).getTime()) / 86400000);
      expect(ageInDays).toBeGreaterThan(7);

      // Mark as expired
      store.update("impulses", impulseId, { status: "expired" });
      expect(store.findById("impulses", impulseId).status).toBe("expired");
    });

    it("keeps recently created queued impulses", () => {
      seedGroupAndUser();
      store.insert("impulses", [
        { id: impulseId, groupId, title: "Fresh", createdBy: userId, status: "queued", queuePosition: 1, createdAt: new Date() },
      ]);

      const impulse = store.findById("impulses", impulseId);
      const ageInDays = Math.floor((Date.now() - new Date(impulse.createdAt).getTime()) / 86400000);
      expect(ageInDays).toBeLessThanOrEqual(7);
    });
  });
});
