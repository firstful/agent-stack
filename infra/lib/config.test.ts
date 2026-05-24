import { describe, it } from "node:test";
import assert from "node:assert";
import {
  hashMarker,
  slotMarker,
  slotContainerName,
  oppositeSlot,
  slotOf,
  sidecarContainerName,
  isSidecar,
  baseServiceName,
  SLOTS,
  HEALTH_CHECK_TIMEOUT,
} from "./config";

describe("slotContainerName", () => {
  it("formats name with slot suffix", () => {
    assert.strictEqual(slotContainerName("opencode", "a"), "opencode--a");
    assert.strictEqual(slotContainerName("opencode", "b"), "opencode--b");
  });

  it("handles names with dashes", () => {
    assert.strictEqual(
      slotContainerName("kilocode-web", "a"),
      "kilocode-web--a"
    );
  });
});

describe("oppositeSlot", () => {
  it('returns "b" for "a"', () => {
    assert.strictEqual(oppositeSlot("a"), "b");
  });

  it('returns "a" for "b"', () => {
    assert.strictEqual(oppositeSlot("b"), "a");
  });
});

describe("slotOf", () => {
  it("extracts slot from slot container name", () => {
    assert.strictEqual(slotOf("opencode--a"), "a");
    assert.strictEqual(slotOf("opencode--b"), "b");
  });

  it("returns null for non-slot names", () => {
    assert.strictEqual(slotOf("opencode"), null);
    assert.strictEqual(slotOf("opencode--db"), null);
  });
});

describe("hashMarker", () => {
  it("returns path with hash marker", () => {
    assert.strictEqual(hashMarker("opencode"), "/tmp/stack.opencode.hash");
  });
});

describe("slotMarker", () => {
  it("returns path with slot marker", () => {
    assert.strictEqual(slotMarker("opencode"), "/tmp/stack.opencode.slot");
  });
});

describe("sidecarContainerName", () => {
  it("formats service name with sidecar name", () => {
    assert.strictEqual(sidecarContainerName("myapp", "db"), "myapp--db");
    assert.strictEqual(
      sidecarContainerName("myapp", "redis"),
      "myapp--redis"
    );
  });

  it("handles service names with dashes", () => {
    assert.strictEqual(
      sidecarContainerName("kilocode-web", "postgres"),
      "kilocode-web--postgres"
    );
  });
});

describe("isSidecar", () => {
  it("returns true for sidecar container names", () => {
    assert.strictEqual(isSidecar("myapp--db"), true);
    assert.strictEqual(isSidecar("myapp--redis-cache"), true);
    assert.strictEqual(isSidecar("kilocode-web--postgres"), true);
  });

  it("returns false for slot container names", () => {
    assert.strictEqual(isSidecar("myapp--a"), false);
    assert.strictEqual(isSidecar("myapp--b"), false);
    assert.strictEqual(isSidecar("kilocode-web--a"), false);
  });

  it("returns false for bare service names", () => {
    assert.strictEqual(isSidecar("myapp"), false);
    assert.strictEqual(isSidecar("opencode"), false);
  });

  it("returns false for names without double dash", () => {
    assert.strictEqual(isSidecar("simple-name"), false);
  });
});

describe("baseServiceName", () => {
  it("extracts base service name from sidecar name", () => {
    assert.strictEqual(baseServiceName("myapp--db"), "myapp");
    assert.strictEqual(
      baseServiceName("kilocode-web--postgres"),
      "kilocode-web"
    );
  });

  it("extracts base service name from slot name", () => {
    assert.strictEqual(baseServiceName("myapp--a"), "myapp");
    assert.strictEqual(baseServiceName("opencode--b"), "opencode");
  });

  it("returns null for names without double dash", () => {
    assert.strictEqual(baseServiceName("myapp"), null);
    assert.strictEqual(baseServiceName("opencode"), null);
  });
});

describe("constants", () => {
  it("SLOTS contains a and b", () => {
    assert.deepStrictEqual(SLOTS, ["a", "b"]);
  });

  it("HEALTH_CHECK_TIMEOUT is a positive number", () => {
    assert.strictEqual(typeof HEALTH_CHECK_TIMEOUT, "number");
    assert.ok(HEALTH_CHECK_TIMEOUT > 0);
  });
});
