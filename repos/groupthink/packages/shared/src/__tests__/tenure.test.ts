import { describe, it, expect } from "vitest";
import { tenureWeight, reputationDecay, effectiveWeight } from "../lib/tenure";

describe("tenureWeight", () => {
  it("returns 1 for someone who joined today", () => {
    const joined = new Date();
    expect(tenureWeight(joined)).toBe(1);
  });

  it("returns days for multi-day tenure", () => {
    const joined = new Date("2026-01-01");
    const now = new Date("2026-01-11");
    expect(tenureWeight(joined, now)).toBe(10);
  });

  it("returns at least 1 even for negative delta", () => {
    const joined = new Date("2026-02-01");
    const now = new Date("2026-01-01");
    expect(tenureWeight(joined, now)).toBe(1);
  });

  it("scales with longer tenure", () => {
    const joined = new Date("2025-01-01");
    const now = new Date("2026-01-01");
    expect(tenureWeight(joined, now)).toBe(365);
  });
});

describe("reputationDecay", () => {
  it("returns 1 if active today", () => {
    expect(reputationDecay(new Date())).toBeCloseTo(1);
  });

  it("returns 0.5 after one half-life (60 days)", () => {
    const lastActive = new Date("2026-01-01");
    const now = new Date("2026-03-02");
    const decay = reputationDecay(lastActive, now);
    expect(decay).toBeGreaterThan(0.48);
    expect(decay).toBeLessThan(0.52);
  });

  it("returns ~0.25 after two half-lives (120 days)", () => {
    const lastActive = new Date("2026-01-01");
    const now = new Date("2026-05-01");
    const decay = reputationDecay(lastActive, now);
    expect(decay).toBeGreaterThan(0.23);
    expect(decay).toBeLessThan(0.27);
  });

  it("returns ~1 for same-day (within hours)", () => {
    const now = new Date();
    const sameDay = new Date(now.getTime() - 1000 * 60 * 60);
    expect(reputationDecay(sameDay, now)).toBeCloseTo(1, 2);
  });
});

describe("effectiveWeight", () => {
  it("combines tenure and decay", () => {
    const joined = new Date("2026-01-01");
    const lastActive = new Date("2026-03-01");
    const now = new Date("2026-04-01");
    const weight = effectiveWeight(joined, lastActive, now);
    // ~90 days tenure, ~30 days inactivity decay (~0.707)
    expect(weight).toBeGreaterThan(60);
    expect(weight).toBeLessThan(70);
  });

  it("returns full tenure weight if recently active", () => {
    const joined = new Date("2026-01-01");
    const now = new Date("2026-01-15");
    const weight = effectiveWeight(joined, now, now);
    // ~14 days tenure, full decay
    expect(weight).toBeCloseTo(14, 0);
  });
});
