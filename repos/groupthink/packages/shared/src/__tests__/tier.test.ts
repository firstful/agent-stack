import { describe, it, expect } from "vitest";
import { tierForMemberCount } from "../index";

describe("tierForMemberCount", () => {
  it("returns fringe for 0 members", () => {
    expect(tierForMemberCount(0)).toBe("fringe");
  });

  it("returns fringe for 1-4 members", () => {
    expect(tierForMemberCount(1)).toBe("fringe");
    expect(tierForMemberCount(3)).toBe("fringe");
    expect(tierForMemberCount(4)).toBe("fringe");
  });

  it("returns small for 5-49 members", () => {
    expect(tierForMemberCount(5)).toBe("small");
    expect(tierForMemberCount(25)).toBe("small");
    expect(tierForMemberCount(49)).toBe("small");
  });

  it("returns medium for 50-199 members", () => {
    expect(tierForMemberCount(50)).toBe("medium");
    expect(tierForMemberCount(100)).toBe("medium");
    expect(tierForMemberCount(199)).toBe("medium");
  });

  it("returns large for 200-999 members", () => {
    expect(tierForMemberCount(200)).toBe("large");
    expect(tierForMemberCount(500)).toBe("large");
    expect(tierForMemberCount(999)).toBe("large");
  });

  it("returns huge for 1000-9999 members", () => {
    expect(tierForMemberCount(1000)).toBe("huge");
    expect(tierForMemberCount(5000)).toBe("huge");
    expect(tierForMemberCount(9999)).toBe("huge");
  });

  it("returns massive for 10000+ members", () => {
    expect(tierForMemberCount(10000)).toBe("massive");
    expect(tierForMemberCount(50000)).toBe("massive");
  });
});
