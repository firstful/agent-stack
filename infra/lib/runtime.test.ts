import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";
import type { Service } from "./types";

describe("writeRuntimeState", () => {
  let writeRuntimeState: (services: Service[]) => void;
  let tmpDir: string;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-test-"));
    process.env.STACK_RUNTIME_DIR = tmpDir;
    const mod = await import("./runtime");
    writeRuntimeState = mod.writeRuntimeState;
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeService(overrides: Partial<Service> = {}): Service {
    return {
      name: "test-svc",
      repo: null,
      container: { port: 3000 },
      service: null,
      expose: { enabled: true, hostname: "test.ffilt.us" },
      _file: "test-svc.json",
      _fromRepo: true,
      _hash: "abc123",
      ...overrides,
    };
  }

  it("writes a JSON file", () => {
    writeRuntimeState([makeService()]);
    const outputPath = path.join(tmpDir, "services.json");
    assert.ok(fs.existsSync(outputPath));

    const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    assert.ok(content["test-svc"]);
  });

  it("includes container service fields", () => {
    writeRuntimeState([makeService()]);
    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "services.json"), "utf-8")
    );
    const entry = content["test-svc"];

    assert.strictEqual(entry.name, "test-svc");
    assert.strictEqual(entry.hash, "abc123");
    assert.strictEqual(entry.file, "test-svc.json");
    assert.strictEqual(entry.container?.port, 3000);
    assert.strictEqual(entry.service, null);
    assert.ok(entry.expose);
    assert.strictEqual(entry.exposed, "test.ffilt.us");
    assert.ok(typeof entry.activeSlot === "string");
    assert.ok(entry.slots);
    assert.ok(entry.slots.a);
    assert.ok(entry.slots.b);
  });

  it("includes sidecar state when configured", () => {
    const svc = makeService({
      name: "multi-svc",
      container: {
        port: 3000,
        sidecars: [
          { name: "db", image: "postgres:16", port: 5432 },
          { name: "redis", image: "redis:7", port: 6379 },
        ],
      },
    });
    writeRuntimeState([svc]);
    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "services.json"), "utf-8")
    );
    const entry = content["multi-svc"];
    assert.ok(entry.sidecars);
    assert.ok(entry.sidecars.db);
    assert.strictEqual(entry.sidecars.db.port, 5432);
    assert.strictEqual(typeof entry.sidecars.db.running, "boolean");
    assert.ok(entry.sidecars.redis);
    assert.strictEqual(entry.sidecars.redis.port, 6379);
  });

  it("omits sidecars field when no sidecars configured", () => {
    writeRuntimeState([makeService()]);
    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "services.json"), "utf-8")
    );
    assert.strictEqual(content["test-svc"].sidecars, undefined);
  });

  it("handles systemd services", () => {
    const svc = makeService({
      name: "systemd-svc",
      container: null,
      service: {
        type: "simple",
        exec_start: "/usr/bin/test",
        port: 9090,
      },
    });
    writeRuntimeState([svc]);
    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "services.json"), "utf-8")
    );
    const entry = content["systemd-svc"];
    assert.strictEqual(entry.container, null);
    assert.ok(entry.service);
    assert.strictEqual(entry.service.port, 9090);
    assert.strictEqual(typeof entry.running, "boolean");
  });

  it("tracks sidecars for non-exposed services", () => {
    const svc = makeService({
      name: "internal-svc",
      expose: null,
      container: {
        port: 4000,
        sidecars: [{ name: "cache", image: "memcached:1", port: 11211 }],
      },
    });
    writeRuntimeState([svc]);
    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "services.json"), "utf-8")
    );
    const entry = content["internal-svc"];
    assert.strictEqual(entry.exposed, false);
    assert.ok(entry.sidecars?.cache);
    assert.strictEqual(entry.sidecars.cache.port, 11211);
  });
});
