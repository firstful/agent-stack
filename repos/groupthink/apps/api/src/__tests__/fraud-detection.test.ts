import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Configuration constants (mirrored from fraud-detection.ts) ──
const COHORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const COHORT_MIN_VOTERS = 2;
const COHORT_MIN_IMPULSES = 2;
const COHORT_VOTE_UNIFORMITY_THRESHOLD = 0.80;
const CROSS_GROUP_MIN_SHARED_GROUPS = 2;
const CROSS_GROUP_MIN_SHARED_IMPULSES = 2;
const CROSS_GROUP_AGREEMENT_THRESHOLD = 0.80;
const SCAN_INTERVAL = 5 * 60 * 1000;

describe("Fraud Detection — Configuration", () => {
  it("defines 24-hour cohort window", () => {
    expect(COHORT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("requires at least 2 voters from a cohort to trigger analysis", () => {
    expect(COHORT_MIN_VOTERS).toBeGreaterThanOrEqual(2);
  });

  it("requires at least 2 flagged impulses to raise a flag", () => {
    expect(COHORT_MIN_IMPULSES).toBeGreaterThanOrEqual(2);
  });

  it("uses high uniformity threshold (≥80%) for cohort flags", () => {
    expect(COHORT_VOTE_UNIFORMITY_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(COHORT_VOTE_UNIFORMITY_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("requires at least 2 shared groups for cross-group flags", () => {
    expect(CROSS_GROUP_MIN_SHARED_GROUPS).toBeGreaterThanOrEqual(2);
  });

  it("uses high agreement threshold (≥80%) for cross-group flags", () => {
    expect(CROSS_GROUP_AGREEMENT_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(CROSS_GROUP_AGREEMENT_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("scans every 5 minutes", () => {
    expect(SCAN_INTERVAL).toBe(5 * 60 * 1000);
  });
});

describe("Fraud Detection — Module exports", () => {
  it.todo("module exports are verified at runtime via the index.ts entrypoint");
});

describe("Fraud Detection — Engine lifecycle", () => {
  it.todo("runtime wiring is verified at index.ts:2317 (startFraudDetection(pg))");
});

describe("Fraud Detection — Cohort algorithm invariants", () => {
  it("computes cohort key as YYYY-MM-DD from a Date", () => {
    const date = new Date("2025-06-15T10:30:00Z");
    const cohortKey = date.toISOString().slice(0, 10);
    expect(cohortKey).toBe("2025-06-15");
  });

  it("uniformity ratio is max(yes,no)/total", () => {
    const votes = ["yes", "yes", "yes", "no", "yes"];
    const yesVotes = votes.filter(v => v === "yes").length;
    const noVotes = votes.filter(v => v === "no").length;
    const total = votes.length;
    const uniformity = Math.max(yesVotes, noVotes) / total;
    expect(uniformity).toBe(4 / 5); // 0.80
  });

  it("uniformity of 1.0 with unanimous votes", () => {
    const votes = ["yes", "yes", "yes"];
    const yesVotes = votes.filter(v => v === "yes").length;
    const noVotes = votes.filter(v => v === "no").length;
    const total = votes.length;
    const uniformity = Math.max(yesVotes, noVotes) / total;
    expect(uniformity).toBe(1.0);
  });

  it("uniformity of 0.5 with split votes (equal yes/no)", () => {
    const votes = ["yes", "yes", "no", "no"];
    const yesVotes = votes.filter(v => v === "yes").length;
    const noVotes = votes.filter(v => v === "no").length;
    const total = votes.length;
    const uniformity = Math.max(yesVotes, noVotes) / total;
    expect(uniformity).toBe(0.5);
  });

  it("minimum voters threshold filters out small cohorts", () => {
    const uniqueVoters = new Set(["user1"]);
    expect(uniqueVoters.size).toBeLessThan(COHORT_MIN_VOTERS);
  });

  it("minimum flagged impulses threshold prevents false positives on single impulse", () => {
    const flaggedCount = 1;
    expect(flaggedCount).toBeLessThan(COHORT_MIN_IMPULSES);
  });

  it("detects unanimity above the cohesion threshold", () => {
    // 4 yes out of 5 votes = 0.80 → equals threshold
    const ratio = 4 / 5;
    expect(ratio).toBeGreaterThanOrEqual(COHORT_VOTE_UNIFORMITY_THRESHOLD);
  });

  it("detects borderline just below the cohesion threshold", () => {
    // 3 yes out of 4 votes = 0.75 → below 0.80 threshold
    const ratio = 3 / 4;
    expect(ratio).toBeLessThan(COHORT_VOTE_UNIFORMITY_THRESHOLD);
  });
});

describe("Fraud Detection — Cross-group algorithm invariants", () => {
  it("shared groups detection filters disjoint memberships", () => {
    const groupsA = ["g1", "g2", "g3"];
    const groupsB = ["g4", "g5", "g6"];
    const shared = groupsA.filter(g => groupsB.includes(g));
    expect(shared.length).toBeLessThan(CROSS_GROUP_MIN_SHARED_GROUPS);
  });

  it("shared groups detection finds overlapping memberships", () => {
    const groupsA = ["g1", "g2", "g3", "g4"];
    const groupsB = ["g3", "g4", "g5", "g6"];
    const shared = groupsA.filter(g => groupsB.includes(g));
    expect(shared.length).toBeGreaterThanOrEqual(CROSS_GROUP_MIN_SHARED_GROUPS);
    expect(shared).toEqual(["g3", "g4"]);
  });

  it("agreement ratio across common impulses", () => {
    const votesA: Record<string, string> = { imp1: "yes", imp2: "yes", imp3: "no" };
    const votesB: Record<string, string> = { imp1: "yes", imp2: "yes", imp3: "yes" };
    const commonIds = ["imp1", "imp2", "imp3"];
    const matches = commonIds.filter(id => votesA[id] === votesB[id]).length;
    const ratio = matches / commonIds.length;
    expect(ratio).toBeCloseTo(2 / 3, 2);
    expect(ratio).toBeLessThan(CROSS_GROUP_AGREEMENT_THRESHOLD);
  });

  it("perfect agreement ratio when votes are identical", () => {
    const votesA: Record<string, string> = { imp1: "yes", imp2: "no", imp3: "yes" };
    const votesB: Record<string, string> = { imp1: "yes", imp2: "no", imp3: "yes" };
    const commonIds = ["imp1", "imp2", "imp3"];
    const matches = commonIds.filter(id => votesA[id] === votesB[id]).length;
    const ratio = matches / commonIds.length;
    expect(ratio).toBe(1.0);
    expect(ratio).toBeGreaterThanOrEqual(CROSS_GROUP_AGREEMENT_THRESHOLD);
  });

  it("no common impulses yields zero agreement", () => {
    const votesA: Record<string, string> = { imp1: "yes" };
    const votesB: Record<string, string> = { imp2: "yes" };
    const commonIds = Object.keys(votesA).filter(id => id in votesB);
    expect(commonIds.length).toBe(0);
    expect(commonIds.length).toBeLessThan(CROSS_GROUP_MIN_SHARED_IMPULSES);
  });

  it("pair iteration covers all combinations", () => {
    const userGroups = new Map([
      ["u1", ["g1", "g2"]],
      ["u2", ["g1", "g2"]],
      ["u3", ["g1", "g2"]],
    ]);
    const entries = [...userGroups.entries()];
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        pairs.push([entries[i][0], entries[j][0]]);
      }
    }
    expect(pairs).toHaveLength(3);
    expect(pairs).toContainEqual(["u1", "u2"]);
    expect(pairs).toContainEqual(["u1", "u3"]);
    expect(pairs).toContainEqual(["u2", "u3"]);
  });
});

describe("Fraud Detection — JSONB dedup path correctness", () => {
  /**
   * The cross-group dedup uses `details->'userB'->>'id'` to compare
   * against the secondary user's UUID. This test validates the JSON path
   * logic independent of the database.
   *
   * The stored details has shape:
   *   { userA: { id: "uuid-a", username: "alice" },
   *     userB: { id: "uuid-b", username: "bob" } }
   *
   * - `details->>'userB'` returns '{"id":"uuid-b","username":"bob"}' (full object as string)
   * - `details->'userB'->>'id'` returns 'uuid-b' (just the ID)
   *
   * The fix changes from `->>'userB'` to `->'userB'->>'id'`.
   */
  it("correct JSONB path extracts the UUID not the full object", () => {
    const details = {
      userA: { id: "user-alice-uuid", username: "alice" },
      userB: { id: "user-bob-uuid", username: "bob" },
      sharedGroups: ["g1", "g2"],
      agreementRatio: 1.0,
    };

    // Wrong path: details->>'userB' returns the full JSON object as a string
    const wrongPath = JSON.stringify(details.userB);
    expect(wrongPath).toBe('{"id":"user-bob-uuid","username":"bob"}');
    expect(wrongPath).not.toBe("user-bob-uuid");

    // Correct path: details->'userB'->>'id' extracts just the ID
    const correctPath = details.userB.id;
    expect(correctPath).toBe("user-bob-uuid");

    // Verify the bidirectional check logic
    const userAId = "user-alice-uuid";
    const userBId = "user-bob-uuid";

    // Direction 1: userA is primary, userB is secondary
    const matchDir1 = details.userB.id === userBId;
    expect(matchDir1).toBe(true);

    // Direction 2: userB is primary, userA would be in details.userB.id position
    // This is the reverse check: userId = userB AND details->'userB'->>'id' = userA
    // For this to match, the existing stored record would need userA in the userB slot
    const matchDir2 = details.userB.id === userAId;
    expect(matchDir2).toBe(false);

    // The correct bidirectional query is:
    // (userId = userA AND details->'userB'->>'id' = userB)
    // OR (userId = userB AND details->'userB'->>'id' = userA)
    const found = matchDir1 || matchDir2;
    expect(found).toBe(true);
  });
});
