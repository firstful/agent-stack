import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

import { hashDir, resolveSecrets, loadDesired, repoHashForPath, interpolateSecrets, discoverRequiredSecrets } from "./services";

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

describe("discoverRequiredSecrets", () => {
  it("returns empty array when no {SECRETS.KEY} patterns exist", () => {
    const env = { HOST: "localhost", PORT: "5432" };
    assert.deepStrictEqual(discoverRequiredSecrets(env), []);
  });

  it("discovers a single secret key from env values", () => {
    const env = { DB_URL: "http://{SECRETS.A}:***@host/db" };
    assert.deepStrictEqual(discoverRequiredSecrets(env), ["A"]);
  });

  it("discovers multiple unique keys in order", () => {
    const env = { URL: "http://{SECRETS.USER}:***@{SECRETS.HOST}/" };
    assert.deepStrictEqual(discoverRequiredSecrets(env), ["USER", "HOST"]);
  });

  it("returns empty array for empty env", () => {
    assert.deepStrictEqual(discoverRequiredSecrets({}), []);
  });

  it("does not match bare {KEY} without SECRETS. prefix", () => {
    const env = { X: "{FOO}" };
    assert.deepStrictEqual(discoverRequiredSecrets(env), []);
  });
});

describe("interpolateSecrets", () => {
  it("leaves env vars without interpolation markers unchanged", () => {
    const env = { HOST: "localhost", PORT: "5432" };
    const secrets = { PASSWORD: "hunter2" };
    const result = interpolateSecrets(env, secrets);
    assert.deepStrictEqual(result, { HOST: "localhost", PORT: "5432" });
  });

  it("replaces {SECRETS.KEY} with the corresponding secret value", () => {
    const env = { DATABASE_URL: "postgresql://fuselocal:***@fuse--db:5432/fuse" };
    const secrets = { POSTGRES_PASSWORD: "fuselocalpw" };
    const result = interpolateSecrets(env, secrets);
    assert.strictEqual(result.DATABASE_URL, "postgresql://fuselocal:***@fuse--db:5432/fuse");
  });

  it("replaces multiple {SECRETS.KEY} patterns in a single value", () => {
    const env = { URL: "http://{SECRETS.USER}:***@{SECRETS.HOST}:{SECRETS.PORT}/path" };
    const secrets = { USER: "admin", PASSWORD: "secret", HOST: "db.example.com", PORT: "5432" };
    const result = interpolateSecrets(env, secrets);
    assert.strictEqual(result.URL, "http://admin:***@db.example.com:5432/path");
  });

  it("leaves {SECRETS.KEY} intact when secret is not resolved", () => {
    const env = { URL: "postgresql://user:***@host/db" };
    const secrets = {};
    const result = interpolateSecrets(env, secrets);
    assert.strictEqual(result.URL, "postgresql://user:***@host/db");
  });

  it("does not confuse overlapping key names", () => {
    const env = { CONN: "{SECRETS.PASS} and {SECRETS.PASSPHRASE}" };
    const secrets = { PASS: "p1", PASSPHRASE: "p2" };
    const result = interpolateSecrets(env, secrets);
    assert.strictEqual(result.CONN, "p1 and p2");
  });

  it("does not match bare {KEY} without SECRETS. prefix", () => {
    const env = { X: "{POSTGRES_PASSWORD}" };
    const secrets = { POSTGRES_PASSWORD: "should-not-match" };
    const result = interpolateSecrets(env, secrets);
    assert.strictEqual(result.X, "{POSTGRES_PASSWORD}");
  });

  it("handles empty env and empty secrets", () => {
    assert.deepStrictEqual(interpolateSecrets({}, {}), {});
    assert.deepStrictEqual(interpolateSecrets({ A: "plain" }, {}), { A: "plain" });
    assert.deepStrictEqual(interpolateSecrets({}, { X: "y" }), {});
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

// ═══════════════════════════════════════════════════════════════════════
// matchesWatch — v4 watch-based change detection
// ═══════════════════════════════════════════════════════════════════════

import { matchesWatch, globToRegex } from "./services";

describe("globToRegex", () => {
  it("matches simple file globs", () => {
    const re = globToRegex("*.ts");
    assert.ok(re.test("file.ts"));
    assert.ok(!re.test("file.js"));
  });

  it("matches ** for any depth", () => {
    const re = globToRegex("src/**");
    assert.ok(re.test("src/index.ts"));
    assert.ok(re.test("src/sub/deep/file.ts"));
    assert.ok(!re.test("lib/index.ts"));
  });

  it("matches leading / as root-anchored", () => {
    const re = globToRegex("/src");
    assert.ok(re.test("src"));
    assert.ok(!re.test("lib/src"));
  });
});

describe("matchesWatch", () => {
  it("returns true when a changed file matches an include pattern", () => {
    assert.ok(matchesWatch(["src/index.ts"], ["src/**"]));
  });

  it("returns false when no changed file matches any include pattern", () => {
    assert.ok(!matchesWatch(["README.md", "docs/guide.md"], ["src/**"]));
  });

  it("excludes files matching exclude patterns", () => {
    assert.ok(!matchesWatch(
      ["src/index.test.ts"],
      ["src/**"],
      ["**/*.test.ts"],
    ));
  });

  it("matches files that pass include but not exclude", () => {
    assert.ok(matchesWatch(
      ["src/index.ts", "src/utils.test.ts"],
      ["src/**"],
      ["**/*.test.ts"],
    ));
  });

  it("handles multiple include patterns", () => {
    assert.ok(matchesWatch(
      ["package.json"],
      ["src/**", "package.json", "Containerfile"],
    ));
  });

  it("handles empty changed files list", () => {
    assert.ok(!matchesWatch([], ["src/**"]));
  });

  it("uses ** to match everything", () => {
    assert.ok(matchesWatch(["README.md"], ["**"]));
    assert.ok(matchesWatch(["deep/nested/file.ts"], ["**"]));
  });

  it("respects leading / anchor", () => {
    // /src should only match src at root
    assert.ok(!matchesWatch(["lib/src/file.ts"], ["/src/**"]));
  });
});
