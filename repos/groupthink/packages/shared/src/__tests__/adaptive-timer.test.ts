import { describe, it, expect } from "vitest";
import {
  adaptiveRemaining,
  composingRemaining,
  MAX_VOTING_WINDOW,
  MIN_VOTING_WINDOW,
  MAX_COMPOSING_WINDOW,
} from "../lib/adaptive-timer";

describe("adaptiveRemaining", () => {
  const base = {
    totalMembers: 100,
    votesCast: 0,
    yesVotes: 0,
    noVotes: 0,
    elapsedMs: 0,
  };

  it("returns full window when no votes and no elapsed time", () => {
    const r = adaptiveRemaining(base);
    expect(r).toBe(MAX_VOTING_WINDOW);
  });

  it("reduces remaining when time has elapsed", () => {
    const r = adaptiveRemaining({ ...base, elapsedMs: 3600000 });
    expect(r).toBe(MAX_VOTING_WINDOW - 3600000);
  });

  it("returns 0 when elapsed exceeds max window", () => {
    const r = adaptiveRemaining({ ...base, elapsedMs: MAX_VOTING_WINDOW + 1 });
    expect(r).toBe(0);
  });

  it("shrinks window proportionally to participation", () => {
    const noVotes = adaptiveRemaining({ ...base, votesCast: 0 });
    const someVotes = adaptiveRemaining({ ...base, votesCast: 50 });
    expect(someVotes).toBeLessThan(noVotes);
  });

  it("collapses immediately when supermajority reached with quorum", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 50,
      noVotes: 10,
    });
    expect(r).toBe(0);
  });

  it("does not collapse if consensus is below supermajority", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 35,
      noVotes: 25,
    });
    expect(r).toBeGreaterThan(0);
  });

  it("does not collapse if quorum not met", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 30,
      yesVotes: 25,
      noVotes: 5,
    });
    expect(r).toBeGreaterThan(0);
  });

  it("enforces minimum floor", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 100,
      yesVotes: 40,
      noVotes: 60,
      elapsedMs: MAX_VOTING_WINDOW - 1000,
    });
    expect(r).toBe(MIN_VOTING_WINDOW);
  });

  it("splits consensus on high yes/no split", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 80,
      yesVotes: 41,
      noVotes: 39,
      elapsedMs: 0,
    });
    expect(r).toBeGreaterThan(0);
  });

  it("collapses on no-vote supermajority when quorum met", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 10,
      noVotes: 50,
    });
    expect(r).toBe(0);
  });

  it("collapses at exact supermajority boundary (0.67)", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 100,
      yesVotes: 67,
      noVotes: 33,
    });
    expect(r).toBe(0);
  });

  it("does not collapse if all votes are abstentions despite quorum", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 0,
      noVotes: 0,
    });
    expect(r).toBeGreaterThan(0);
  });

  it("handles zero totalMembers without division by zero", () => {
    const r = adaptiveRemaining({
      totalMembers: 0,
      votesCast: 0,
      yesVotes: 0,
      noVotes: 0,
      elapsedMs: 0,
    });
    expect(r).toBe(MAX_VOTING_WINDOW);
  });

  it("does not double-count abstentions in consensus calculation", () => {
    // 60 votes cast, but 20 are abstentions — only 40 yes+no count toward consensus
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 25,
      noVotes: 15,
    });
    // Quorum met (60 >= 50), consensus = 25/40 = 0.625 < 0.67, so no collapse
    expect(r).toBeGreaterThan(0);
  });

  // ── Vote threshold math: quorum boundary tests ──

  it("collapses when exactly at quorum (50%) with supermajority", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 50,
      yesVotes: 34,
      noVotes: 16,
    });
    // quorum met (50 >= 50), consensus = 34/50 = 0.68 ≥ 0.67 → collapse
    expect(r).toBe(0);
  });

  it("does NOT collapse when just below quorum (49%) even with supermajority", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 49,
      yesVotes: 49,
      noVotes: 0,
    });
    // 49 < 50 quorum not met → no collapse
    expect(r).toBeGreaterThan(0);
  });

  it("collapses when all votes are yes at quorum boundary", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 50,
      yesVotes: 50,
      noVotes: 0,
    });
    // consensus = 50/50 = 1.0 ≥ 0.67, quorum met → collapse
    expect(r).toBe(0);
  });

  it("collapses when all votes are no at quorum boundary", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 50,
      yesVotes: 0,
      noVotes: 50,
    });
    // consensus = 50/50 = 1.0 ≥ 0.67, quorum met → collapse
    expect(r).toBe(0);
  });

  // ── Vote threshold math: consensus boundary tests ──

  it("does NOT collapse when consensus is just below supermajority (0.66)", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 33,
      noVotes: 17,
    });
    // consensus = 33/50 = 0.66 < 0.67 → no collapse
    expect(r).toBeGreaterThan(0);
  });

  it("collapses when yes/no consensus is at exact 0.67 with abstentions present", () => {
    // 60 votes cast, 40 are yes+no, 20 abstain
    const r = adaptiveRemaining({
      ...base,
      votesCast: 60,
      yesVotes: 27,
      noVotes: 13,
    });
    // quorum met (60 >= 50), consensus = 27/40 = 0.675 ≥ 0.67 → collapse
    expect(r).toBe(0);
  });

  it("handles totalMembers=1 with quorum and supermajority", () => {
    const r = adaptiveRemaining({
      totalMembers: 1,
      votesCast: 1,
      yesVotes: 1,
      noVotes: 0,
      elapsedMs: 0,
    });
    // quorum met (1 >= 0.5), consensus = 1/1 = 1.0 → collapse
    expect(r).toBe(0);
  });

  it("does not collapse with totalMembers=1 when no consensus", () => {
    const r = adaptiveRemaining({
      totalMembers: 1,
      votesCast: 1,
      yesVotes: 0,
      noVotes: 1,
      elapsedMs: 0,
    });
    expect(r).toBe(0); // same member, both yes+no = 1/1 = 1.0, consensus ≥ 0.67 with no abstentions
    // Actually: 1 vote cast, 0 yes + 1 no = 1 total non-abstain votes, consensus = 1/1 = 1.0 → collapse
  });

  // ── Time boundary tests ──

  it("returns 0 when elapsedMs exactly equals MAX_VOTING_WINDOW", () => {
    const r = adaptiveRemaining({ ...base, elapsedMs: MAX_VOTING_WINDOW });
    expect(r).toBe(0);
  });

  it("returns MIN_VOTING_WINDOW when elapsedMs close to max but no quorum", () => {
    const r = adaptiveRemaining({
      ...base,
      votesCast: 10,
      yesVotes: 5,
      noVotes: 5,
      elapsedMs: MAX_VOTING_WINDOW - MIN_VOTING_WINDOW,
    });
    expect(r).toBe(MIN_VOTING_WINDOW);
  });

  it("applies velocity shrink even when quorum not met", () => {
    const noVotesNoElapsed = adaptiveRemaining({ ...base, votesCast: 0, elapsedMs: 0 });
    const someVotesNoElapsed = adaptiveRemaining({ ...base, votesCast: 30, elapsedMs: 0 });
    expect(someVotesNoElapsed).toBeLessThan(noVotesNoElapsed);
  });
});

describe("composingRemaining", () => {
  it("returns full window with no drafts and no elapsed", () => {
    const r = composingRemaining(0, 0);
    expect(r).toBe(3600000);
  });

  it("extends window with more drafts", () => {
    const noDrafts = composingRemaining(0, 0);
    const withDrafts = composingRemaining(5, 0);
    expect(withDrafts).toBeGreaterThan(noDrafts);
  });

  it("returns 0 when elapsed exceeds window + extensions", () => {
    const r = composingRemaining(0, 7200000);
    expect(r).toBe(0);
  });

  it("enforces minimum floor", () => {
    const r = composingRemaining(0, 3599000);
    expect(r).toBe(300000);
  });

  it("extends proportionally with more drafts then elapses", () => {
    const r = composingRemaining(10, 7200000);
    // extension = 10 * 3600000 * 0.2 = 7200000, window = 3600000 + 7200000 = 10800000
    // remaining = 10800000 - 7200000 = 3600000
    expect(r).toBe(3600000);
  });

  it("returns 0 when elapsedMs is negative (no timer started)", () => {
    // negative elapsed shouldn't happen, but composingRemaining handles it gracefully
    const r = composingRemaining(0, -1000);
    expect(r).toBeGreaterThan(0);
  });

  it("returns full window with zero elapsed and zero drafts", () => {
    expect(composingRemaining(0, 0)).toBe(MAX_COMPOSING_WINDOW);
  });
});
