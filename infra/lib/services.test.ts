import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

import { hashDir, resolveSecrets, loadDesired, repoHashForPath } from "./services";

describe("hashDir", () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hashdir-test-"));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns consistent hash for same content", () => {
    fs.writeFileSync(path.join(tmp, "a.txt"), "hello");
    const h1 = hashDir(tmp);
    const h2 = hashDir(tmp);
    assert.strictEqual(h1, h2);
  });

  it("returns different hash for different content", () => {
    fs.writeFileSync(path.join(tmp, "b.txt"), "world");
    const h1 = hashDir(tmp);
    fs.writeFileSync(path.join(tmp, "b.txt"), "changed");
    const h2 = hashDir(tmp);
    assert.notStrictEqual(h1, h2);
  });

  it("skips dotfiles", () => {
    fs.writeFileSync(path.join(tmp, ".secret"), "hidden");
    fs.writeFileSync(path.join(tmp, "c.txt"), "visible");
    const h1 = hashDir(tmp);
    fs.writeFileSync(path.join(tmp, ".secret"), "modified");
    const h2 = hashDir(tmp);
    assert.strictEqual(h1, h2);
  });

  it("skips node_modules", () => {
    fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "node_modules", "dep.js"), "blob");
    const h1 = hashDir(tmp);
    fs.writeFileSync(path.join(tmp, "node_modules", "dep.js"), "changed");
    const h2 = hashDir(tmp);
    assert.strictEqual(h1, h2);
  });

  it("includes subdirectory content", () => {
    fs.mkdirSync(path.join(tmp, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "sub", "nested.txt"), "deep");
    const h1 = hashDir(tmp);
    fs.writeFileSync(path.join(tmp, "sub", "nested.txt"), "deeper");
    const h2 = hashDir(tmp);
    assert.notStrictEqual(h1, h2);
  });

  it("returns empty string for non-existent dir", () => {
    assert.strictEqual(hashDir("/nonexistent-path-xyz"), "");
  });
});

describe("resolveSecrets", () => {
  it("returns empty object when no secrets requested", () => {
    assert.deepStrictEqual(resolveSecrets({ secrets: [] } as any), {});
  });

  it("throws when VAULT_TOKEN not set and secrets requested", () => {
    const old = process.env.VAULT_TOKEN;
    delete process.env.VAULT_TOKEN;
    try {
      assert.throws(
        () => resolveSecrets({ name: "test", secrets: ["KEY"] } as any),
        /VAULT_TOKEN is not set/
      );
    } finally {
      if (old !== undefined) process.env.VAULT_TOKEN = old;
    }
  });
});

describe("loadDesired", () => {
  it("returns an array of services", () => {
    const result = loadDesired();
    assert.ok(Array.isArray(result));
  });

  it("each service has required fields", () => {
    const result = loadDesired();
    for (const svc of result) {
      assert.ok(typeof svc.name === "string", `name missing for ${svc.name}`);
      assert.ok(typeof svc._hash === "string", `hash missing for ${svc.name}`);
      assert.ok(typeof svc._file === "string", `file missing for ${svc.name}`);
    }
  });

  it("marks repo services with _fromRepo true", () => {
    const result = loadDesired();
    for (const svc of result) {
      if (svc.repo) {
        assert.strictEqual(svc._fromRepo, true);
      }
    }
  });
});

describe("repoHashForPath", () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repohash-test-"));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("falls back to hashDir when not in a monorepo", () => {
    const sub = path.join(tmp, "myservice");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "file.txt"), "hello");
    const expected = hashDir(sub);
    const actual = repoHashForPath(sub);
    assert.strictEqual(actual, expected);
  });

  it("works for empty directories", () => {
    const sub = path.join(tmp, "empty");
    fs.mkdirSync(sub, { recursive: true });
    const h = repoHashForPath(sub);
    assert.ok(typeof h === "string");
  });
});
