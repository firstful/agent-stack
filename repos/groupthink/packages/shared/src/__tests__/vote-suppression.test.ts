import { describe, it, expect } from "vitest";
import {
  suppressionFactor,
  applyVoteSuppression,
  SUPPRESSED_VOTE_RATIO,
} from "../lib/vote-suppression";

describe("suppressionFactor", () => {
  it("returns 1.0 for a clean account", () => {
    expect(suppressionFactor(false, false)).toBe(1.0);
  });

  it("returns SUPPRESSED_VOTE_RATIO for fraud-flagged only", () => {
    expect(suppressionFactor(false, true)).toBe(SUPPRESSED_VOTE_RATIO);
  });

  it("returns 0.0 for shadow-banned only", () => {
    expect(suppressionFactor(true, false)).toBe(0);
  });

  it("returns 0.0 when both shadow-banned and fraud-flagged (stricter wins)", () => {
    expect(suppressionFactor(true, true)).toBe(0);
  });

  it("ratio is 0.5 (50% weight reduction)", () => {
    expect(SUPPRESSED_VOTE_RATIO).toBe(0.5);
  });
});

describe("applyVoteSuppression", () => {
  it("returns full base weight for a clean account", () => {
    expect(applyVoteSuppression(100, false, false)).toBe(100);
  });

  it("returns half of base weight for a fraud-flagged account", () => {
    expect(applyVoteSuppression(100, false, true)).toBe(50);
  });

  it("returns 0 for a shadow-banned account", () => {
    expect(applyVoteSuppression(100, true, false)).toBe(0);
  });

  it("returns 0 when both shadow-banned and fraud-flagged", () => {
    expect(applyVoteSuppression(100, true, true)).toBe(0);
  });

  it("returns rounded weight (Math.round) for odd values with suppression", () => {
    expect(applyVoteSuppression(101, false, true)).toBe(51); // 101 * 0.5 = 50.5 → 51
  });

  it("returns 0 for zero base weight", () => {
    expect(applyVoteSuppression(0, false, false)).toBe(0);
    expect(applyVoteSuppression(0, true, false)).toBe(0);
    expect(applyVoteSuppression(0, false, true)).toBe(0);
  });

  it("never returns negative weight", () => {
    // Base weight is always ≥ 0 in practice, but guard against negative input
    expect(applyVoteSuppression(-10, false, false)).toBe(0);
  });

  it("returns small weights correctly at suppression ratio", () => {
    // weight=1, fraud-flagged → 1 * 0.5 = 0.5 → Math.round(0.5) = 1
    expect(applyVoteSuppression(1, false, true)).toBe(1);
    // weight=2, fraud-flagged → 2 * 0.5 = 1.0 → Math.round(1.0) = 1
    expect(applyVoteSuppression(2, false, true)).toBe(1);
    // weight=3, fraud-flagged → 3 * 0.5 = 1.5 → Math.round(1.5) = 2
    expect(applyVoteSuppression(3, false, true)).toBe(2);
  });

  it("rounds down for weights just below .5 boundary", () => {
    // weight=99, fraud-flagged → 99 * 0.5 = 49.5 → Math.round(49.5) = 50
    expect(applyVoteSuppression(99, false, true)).toBe(50);
  });

  it("suppression does not depend on base weight (pure multiplier)", () => {
    const clean = applyVoteSuppression(200, false, false);
    const flagged = applyVoteSuppression(200, false, true);
    expect(flagged).toBe(100); // 200 * 0.5 = 100
    expect(clean).toBe(200);   // 200 * 1.0 = 200
  });

  it("shadow ban suppresses regardless of fraud status", () => {
    expect(applyVoteSuppression(1000, true, false)).toBe(0);
    expect(applyVoteSuppression(1000, true, true)).toBe(0);
  });

  it("handles very large base weights without overflow", () => {
    const large = 1_000_000_000;
    expect(applyVoteSuppression(large, false, true)).toBe(Math.round(large * SUPPRESSED_VOTE_RATIO));
    expect(applyVoteSuppression(large, true, false)).toBe(0);
    expect(applyVoteSuppression(large, false, false)).toBe(large);
  });
});
