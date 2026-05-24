import { describe, it, expect } from "vitest";
import {
  adaptiveRemaining,
  composingRemaining,
  MAX_VOTING_WINDOW,
  MIN_VOTING_WINDOW,
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
});
