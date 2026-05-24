import { describe, it, expect } from "vitest";
import { sortQueue, assignQueuePositions } from "../lib/queue";

describe("sortQueue", () => {
  const makeImp = (
    id: string,
    tenureDays: number,
    daysAgo: number
  ) => ({
    id,
    createdBy: "user-1",
    createdAt: new Date(Date.now() - daysAgo * 86400000),
    tenureDays,
  });

  it("puts higher tenure first", () => {
    const imps = [makeImp("a", 1, 0), makeImp("b", 100, 0)];
    const sorted = sortQueue(imps);
    expect(sorted[0].id).toBe("b");
  });

  it("tie-breaks by createdAt (older first)", () => {
    const imps = [
      makeImp("newer", 10, 1),
      makeImp("older", 10, 30),
    ];
    const sorted = sortQueue(imps);
    expect(sorted[0].id).toBe("older");
  });

  it("handles empty array", () => {
    expect(sortQueue([])).toEqual([]);
  });

  it("does not mutate original", () => {
    const imps = [makeImp("a", 5, 0), makeImp("b", 10, 0)];
    const copy = [...imps];
    sortQueue(imps);
    expect(imps).toEqual(copy);
  });
});

describe("assignQueuePositions", () => {
  it("assigns 1-based sequential positions", () => {
    const imps = [
      { id: "a", createdBy: "u1", createdAt: new Date("2026-01-01"), tenureDays: 1 },
      { id: "b", createdBy: "u2", createdAt: new Date("2026-01-02"), tenureDays: 100 },
    ];
    const result = assignQueuePositions(imps);
    expect(result[0].position).toBe(1);
    expect(result[1].position).toBe(2);
  });
});
