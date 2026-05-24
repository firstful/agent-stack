import { describe, it, expect } from "vitest";
import { canTransition, assertTransition } from "../lib/state-machine";

describe("state machine transitions", () => {
  describe("canTransition", () => {
    const valid: [string, string][] = [
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

    it.each(valid)("allows %s → %s", (from, to) => {
      expect(canTransition(from as any, to as any)).toBe(true);
    });

    const invalid: [string, string][] = [
      ["queued", "broadcast"],
      ["queued", "composing"],
      ["queued", "expired"],
      ["voting", "broadcast"],
      ["voting", "discarded"],
      ["composing", "broadcast"],
      ["composing", "discarded"],
      ["approval", "expired"],
      ["broadcast", "composing"],
      ["expired", "queued"],
      ["discarded", "voting"],
    ];

    it.each(invalid)("rejects %s → %s", (from, to) => {
      expect(canTransition(from as any, to as any)).toBe(false);
    });

    it("terminal states have no outgoing transitions", () => {
      expect(canTransition("broadcast", "expired")).toBe(false);
      expect(canTransition("broadcast", "discarded")).toBe(false);
      expect(canTransition("broadcast", "voting")).toBe(false);
      expect(canTransition("expired", "queued")).toBe(false);
      expect(canTransition("discarded", "queued")).toBe(false);
    });
  });

  describe("assertTransition", () => {
    it("does not throw for valid transitions", () => {
      expect(() => assertTransition("queued", "voting")).not.toThrow();
      expect(() => assertTransition("voting", "composing")).not.toThrow();
    });

    it("throws for invalid transitions", () => {
      expect(() => assertTransition("queued", "broadcast")).toThrow(
        "Invalid transition: queued → broadcast"
      );
      expect(() => assertTransition("broadcast", "queued")).toThrow(
        "Invalid transition: broadcast → queued"
      );
    });
  });
});
