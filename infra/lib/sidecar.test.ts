import { describe, it } from "node:test";
import assert from "node:assert";
import type { Service, SidecarConfig } from "./types";
import { sidecarContainerName, isSidecar, baseServiceName } from "./config";

// Pure logic tests for sidecar naming/identification

describe("sidecar container naming", () => {
  const cases: [string, string, string][] = [
    ["myapp", "db", "myapp--db"],
    ["myapp", "redis-cache", "myapp--redis-cache"],
    ["kilocode-web", "postgres", "kilocode-web--postgres"],
  ];

  for (const [svc, sidecar, expected] of cases) {
    it(`naming: ${svc} + ${sidecar} → ${expected}`, () => {
      assert.strictEqual(sidecarContainerName(svc, sidecar), expected);
    });
  }
});

describe("isSidecar detection", () => {
  it("detects sidecar containers", () => {
    assert.ok(isSidecar("myapp--db"));
    assert.ok(isSidecar("myapp--redis"));
    assert.ok(isSidecar("kilocode-web--postgres"));
  });

  it("rejects slot containers", () => {
    assert.ok(!isSidecar("myapp--a"));
    assert.ok(!isSidecar("myapp--b"));
    assert.ok(!isSidecar("opencode--b"));
  });

  it("rejects bare service names", () => {
    assert.ok(!isSidecar("myapp"));
    assert.ok(!isSidecar("opencode"));
  });
});

describe("baseServiceName extraction", () => {
  it("extracts from sidecar names", () => {
    assert.strictEqual(baseServiceName("myapp--db"), "myapp");
    assert.strictEqual(
      baseServiceName("kilocode-web--postgres"),
      "kilocode-web"
    );
  });

  it("extracts from slot names", () => {
    assert.strictEqual(baseServiceName("opencode--a"), "opencode");
    assert.strictEqual(baseServiceName("opencode--b"), "opencode");
  });

  it("returns null for names without double dash", () => {
    assert.strictEqual(baseServiceName("myapp"), null);
    assert.strictEqual(baseServiceName(""), null);
  });
});

describe("sidecar config structure", () => {
  it("validates sidecar config shape", () => {
    const sc: SidecarConfig = {
      name: "db",
      image: "docker.io/postgres:16-alpine",
      port: 5432,
      env: { POSTGRES_PASSWORD: "secret" },
      volumes: ["pgdata:/var/lib/postgresql/data"],
    };

    assert.strictEqual(sc.name, "db");
    assert.strictEqual(sc.image, "docker.io/postgres:16-alpine");
    assert.strictEqual(sc.port, 5432);
    assert.strictEqual(sc.env!.POSTGRES_PASSWORD, "secret");
    assert.strictEqual(sc.volumes![0], "pgdata:/var/lib/postgresql/data");
  });

  it("accepts sidecars on a Service", () => {
    const svc: Service = {
      name: "myapp",
      repo: "/tmp/myapp",
      version: 1,
      container: {
        port: 3000,
        sidecars: [
          {
            name: "db",
            image: "postgres:16-alpine",
            port: 5432,
          },
        ],
      },
      service: null,
      expose: { enabled: true, hostname: "myapp.ffilt.us" },
      _file: "myapp.json",
      _fromRepo: true,
      _hash: "abc123",
    };

    assert.ok(svc.container!.sidecars);
    assert.strictEqual(svc.container!.sidecars!.length, 1);
    assert.strictEqual(svc.container!.sidecars![0].name, "db");
    assert.strictEqual(svc.container!.sidecars![0].image, "postgres:16-alpine");
  });

  it("supports multiple sidecars per service", () => {
    const svc: Service = {
      name: "myapp",
      repo: null,
      container: {
        port: 3000,
        sidecars: [
          { name: "db", image: "postgres:16-alpine", port: 5432 },
          { name: "redis", image: "redis:7-alpine", port: 6379 },
        ],
      },
      service: null,
      expose: { enabled: true, hostname: "myapp.ffilt.us" },
      _file: "myapp.json",
      _fromRepo: true,
      _hash: "def456",
    };

    assert.strictEqual(svc.container!.sidecars!.length, 2);
    assert.strictEqual(
      sidecarContainerName(svc.name, svc.container!.sidecars![0].name),
      "myapp--db"
    );
    assert.strictEqual(
      sidecarContainerName(svc.name, svc.container!.sidecars![1].name),
      "myapp--redis"
    );
  });
});
