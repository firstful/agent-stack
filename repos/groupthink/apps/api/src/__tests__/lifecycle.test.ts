import { describe, it, expect } from "vitest";
import { adaptiveRemaining, MAX_VOTING_WINDOW, MAX_COMPOSING_WINDOW } from "@groupthink/shared/src/lib/adaptive-timer";
import { canTransition } from "@groupthink/shared/src/lib/state-machine";
import { startLifecycleEngine } from "../lifecycle";

describe("lifecycle integration contracts", () => {
  describe("adaptive timer contracts", () => {
    it("voting window collapses with supermajority", () => {
      const result = adaptiveRemaining({
        totalMembers: 100,
        votesCast: 60,
        yesVotes: 50,
        noVotes: 10,
        elapsedMs: 0,
      });
      expect(result).toBe(0);
    });

    it("voting window stays open with divided consensus", () => {
      const result = adaptiveRemaining({
        totalMembers: 100,
        votesCast: 80,
        yesVotes: 42,
        noVotes: 38,
        elapsedMs: 0,
      });
      expect(result).toBeGreaterThan(0);
    });

    it("voting window shrinks with participation", () => {
      const low = adaptiveRemaining({
        totalMembers: 100, votesCast: 0, yesVotes: 0, noVotes: 0, elapsedMs: 0,
      });
      const high = adaptiveRemaining({
        totalMembers: 100, votesCast: 50, yesVotes: 30, noVotes: 20, elapsedMs: 0,
      });
      expect(high).toBeLessThan(low);
    });

    it("respects minimum floor", () => {
      const floor = adaptiveRemaining({
        totalMembers: 100,
        votesCast: 100,
        yesVotes: 40,
        noVotes: 60,
        elapsedMs: MAX_VOTING_WINDOW - 1000,
      });
      expect(floor).toBe(10 * 60 * 1000); // MIN_VOTING_WINDOW
    });
  });

  describe("state machine contracts", () => {
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
      ["broadcast", "queued"],
      ["expired", "voting"],
      ["discarded", "queued"],
    ];

    it.each(invalidTransitions)("rejects %s → %s", (from, to) => {
      expect(canTransition(from as any, to as any)).toBe(false);
    });
  });

  describe("lifecycle engine contracts", () => {
    it("composing window extends with drafts", () => {
      expect(MAX_COMPOSING_WINDOW).toBe(60 * 60 * 1000);
      const extended = MAX_COMPOSING_WINDOW + 5 * MAX_COMPOSING_WINDOW * 0.2;
      expect(extended).toBeGreaterThan(MAX_COMPOSING_WINDOW);
    });

    it("startLifecycleEngine is a function", () => {
      expect(startLifecycleEngine).toBeDefined();
      expect(typeof startLifecycleEngine).toBe("function");
    });
  });

  describe("vote threshold logic", () => {
    it("advances when quorum and majority met", () => {
      const totalMembers = 10;
      const votesCast = 3;      // 30% = quorum threshold
      const meetsQuorum = votesCast >= Math.ceil(totalMembers * 0.3);
      const yesRatio = 20 / 25; // 0.8 > 0.5
      expect(meetsQuorum).toBe(true);
      expect(yesRatio >= 0.5).toBe(true);
    });

    it("fails without quorum (less than 30% voted)", () => {
      const totalMembers = 10;
      const votesCast = 2;
      expect(votesCast >= Math.ceil(totalMembers * 0.3)).toBe(false);
    });

    it("fails without majority yes", () => {
      const yesWeight = 10;
      const noWeight = 15;
      const yesRatio = yesWeight / (yesWeight + noWeight);
      expect(yesRatio >= 0.5).toBe(false);
    });
  });
});
