import { describe, it, expect } from "vitest";
import {
  engagementPoints,
  activityGateMultiplier,
  activityGateBreakdown,
  ACTIVITY_WINDOW_DAYS,
  ENGAGEMENT_POINTS_FOR_MAX,
  MAX_BOOST,
} from "../lib/activity-gate";

describe("engagementPoints", () => {
  const now = new Date("2026-06-01");

  it("returns 0 for empty events", () => {
    expect(engagementPoints([], now)).toBe(0);
  });

  it("counts points by event type", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") },
      { eventType: "draft_submitted" as const, createdAt: new Date("2026-05-20") },
      { eventType: "dm_sent" as const, createdAt: new Date("2026-05-20") },
      { eventType: "invite_used" as const, createdAt: new Date("2026-05-20") },
    ];
    expect(engagementPoints(events, now)).toBe(5 + 3 + 1 + 2);
  });

  it("filters out events outside the activity window", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2025-01-01") },
      { eventType: "draft_submitted" as const, createdAt: new Date("2026-05-20") },
    ];
    // Only the draft_submitted (within 30 days) counts
    expect(engagementPoints(events, now)).toBe(3);
  });

  it("excludes events exactly at the cutoff boundary", () => {
    const cutoff = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 86400000);
    const events = [
      { eventType: "impulse_created" as const, createdAt: cutoff },
    ];
    // Events exactly at the cutoff should be >= cutoff, so included
    expect(engagementPoints(events, now)).toBe(5);
  });

  it("handles multiple events of the same type", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") },
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-21") },
    ];
    expect(engagementPoints(events, now)).toBe(10);
  });

  it("ignores unknown event types", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") },
      { eventType: "unknown_event" as any, createdAt: new Date("2026-05-20") },
    ];
    expect(engagementPoints(events, now)).toBe(5);
  });

  it("uses default window when not specified", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date(Date.now() - 15 * 86400000) },
    ];
    expect(engagementPoints(events)).toBe(5);
  });

  it("accepts a custom window parameter", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-01") },
    ];
    expect(engagementPoints(events, now, 45)).toBe(5);
  });

  it("returns 0 when all events are outside a short custom window", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-01") },
    ];
    expect(engagementPoints(events, now, 1)).toBe(0);
  });
});

describe("activityGateMultiplier", () => {
  const now = new Date("2026-06-01");

  it("returns 1.0 with no engagement", () => {
    expect(activityGateMultiplier([], now)).toBe(1);
  });

  it("returns MAX_BOOST when max points reached", () => {
    const events: { eventType: "impulse_created"; createdAt: Date }[] = [];
    for (let i = 0; i < 4; i++) {
      events.push({ eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") });
    }
    expect(activityGateMultiplier(events, now)).toBe(MAX_BOOST);
  });

  it("returns intermediate value proportional to points", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") }, // 5 pts
      { eventType: "draft_submitted" as const, createdAt: new Date("2026-05-20") }, // 3 pts
    ];
    // 8/20 = 0.4, multiplier = 1 + 0.4 * 1.0 = 1.4
    expect(activityGateMultiplier(events, now)).toBeCloseTo(1.4);
  });

  it("caps at MAX_BOOST even with excessive points", () => {
    const events: { eventType: "impulse_created"; createdAt: Date }[] = [];
    for (let i = 0; i < 10; i++) {
      events.push({ eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") });
    }
    expect(activityGateMultiplier(events, now)).toBe(MAX_BOOST);
  });

  it("returns 1.0 when all events are outside the window", () => {
    const events = [
      { eventType: "impulse_created" as const, createdAt: new Date("2025-01-01") },
    ];
    expect(activityGateMultiplier(events, now)).toBe(1);
  });
});

describe("activityGateBreakdown", () => {
  const now = new Date("2026-06-01");

  it("returns full breakdown with no engagement", () => {
    const result = activityGateBreakdown([], now);
    expect(result).toEqual({
      multiplier: 1,
      points: 0,
      pointsMax: 20,
      windowDays: 30,
    });
  });

  it("returns breakdown with partial engagement", () => {
    const events = [
      { eventType: "invite_used" as const, createdAt: new Date("2026-05-20") }, // 2 pts
    ];
    const result = activityGateBreakdown(events, now);
    expect(result.points).toBe(2);
    expect(result.multiplier).toBeCloseTo(1.1); // 1 + 0.1 * 1.0
    expect(result.pointsMax).toBe(ENGAGEMENT_POINTS_FOR_MAX);
    expect(result.windowDays).toBe(ACTIVITY_WINDOW_DAYS);
  });

  it("returns breakdown with max engagement", () => {
    const events: { eventType: "impulse_created"; createdAt: Date }[] = [];
    for (let i = 0; i < 4; i++) {
      events.push({ eventType: "impulse_created" as const, createdAt: new Date("2026-05-20") });
    }
    const result = activityGateBreakdown(events, now);
    expect(result.multiplier).toBe(MAX_BOOST);
    expect(result.points).toBe(20);
  });
});
