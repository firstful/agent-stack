import { describe, it } from "node:test";
import assert from "node:assert";
import {
  normalizeManifest,
  normalizeWatch,
} from "./types";
import type {
  RepoManifest,
  ContainerUnit,
  Service,
} from "./types";

// ── Helpers ──

function makeManifest(overrides: Partial<RepoManifest> = {}): RepoManifest {
  return {
    version: 4,
    name: "testapp",
    ...overrides,
  };
}

function findService(services: Service[], name: string): Service | undefined {
  return services.find((s) => s.name === name);
}

// ═══════════════════════════════════════════════════════════════════════
// normalizeWatch
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeWatch", () => {
  it("converts shorthand array to WatchConfig", () => {
    const result = normalizeWatch(["src/**", "package.json"]);
    assert.deepStrictEqual(result, {
      include: ["src/**", "package.json"],
      exclude: [],
    });
  });

  it("passes through full WatchConfig unchanged", () => {
    const input = { include: ["src/**"], exclude: ["*.test.ts"] };
    const result = normalizeWatch(input);
    assert.deepStrictEqual(result, input);
  });

  it("returns default ['**'] when undefined and no fallback", () => {
    const result = normalizeWatch(undefined);
    assert.deepStrictEqual(result, { include: ["**"], exclude: [] });
  });

  it("uses fallback when undefined", () => {
    const result = normalizeWatch(undefined, ["fallback/**"]);
    assert.deepStrictEqual(result, { include: ["fallback/**"], exclude: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Containers
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — single container", () => {
  it("convenience: collapses to project name when container.name === project.name", () => {
    const manifest = makeManifest({
      name: "talaria",
      containers: [
        { name: "talaria", port: 8321, containerfile: "Containerfile" },
      ],
    });
    const services = normalizeManifest(manifest, "/srv/agent-stack/repos/talaria");
    assert.strictEqual(services.length, 1);
    assert.strictEqual(services[0].name, "talaria");
    assert.strictEqual(services[0].container?.port, 8321);
    assert.strictEqual(services[0].repo, "/srv/agent-stack/repos/talaria");
    assert.strictEqual(services[0]._file, "agent-stack.json");
    assert.strictEqual(services[0]._fromRepo, true);
    assert.strictEqual(services[0].version, 4);
    assert.strictEqual(services[0].service, null);
  });

  it("uses <project>--<container> when names differ", () => {
    const manifest = makeManifest({
      name: "myapp",
      containers: [
        { name: "api", port: 3000 },
      ],
    });
    const services = normalizeManifest(manifest, "/srv/agent-stack/repos/myapp");
    assert.strictEqual(services.length, 1);
    assert.strictEqual(services[0].name, "myapp--api");
  });

  it("carries through build config", () => {
    const manifest = makeManifest({
      name: "myapp",
      containers: [
        {
          name: "myapp",
          port: 3000,
          containerfile: "Containerfile.api",
          build: { network: "host", noCache: true, podmanArgs: "--memory 2g" },
        },
      ],
    });
    const services = normalizeManifest(manifest, "/srv/agent-stack/repos/myapp");
    assert.deepStrictEqual(services[0].build, {
      network: "host",
      no_cache: true,
      podman_args: "--memory 2g",
      containerfile: "Containerfile.api",
    });
  });

  it("carries through runtime config (env, volumes, healthCheck, podmanArgs, command)", () => {
    const manifest = makeManifest({
      name: "svc",
      containers: [
        {
          name: "svc",
          port: 8080,
          autoPort: false,
          hostPort: 9090,
          env: { NODE_ENV: "production" },
          volumes: ["data:/data"],
          podmanArgs: "--memory 1g",
          network: "host",
          command: ["node", "index.js"],
          healthCheck: { path: "/health", timeout: 30000 },
        },
      ],
    });
    const service = normalizeManifest(manifest, "/repos/svc")[0];
    assert.strictEqual(service.container?.port, 8080);
    assert.strictEqual(service.container?.auto_port, false);
    assert.strictEqual(service.container?.host_port, 9090);
    assert.deepStrictEqual(service.container?.env, { NODE_ENV: "production" });
    assert.deepStrictEqual(service.container?.volumes, ["data:/data"]);
    assert.deepStrictEqual(service.container?.command, ["node", "index.js"]);
    assert.strictEqual(service.container?.network, "host");
    assert.deepStrictEqual(service.container?.healthCheck, {
      path: "/health",
      timeout: 30000,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Multi-container
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — multi-container", () => {
  it("produces one Service per container with <project>--<name> keys", () => {
    const manifest = makeManifest({
      name: "myapp",
      containers: [
        { name: "api", port: 3000 },
        { name: "worker", port: 3001 },
        { name: "scheduler", port: 3002 },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/myapp");
    assert.strictEqual(services.length, 3);
    assert.ok(findService(services, "myapp--api"));
    assert.ok(findService(services, "myapp--worker"));
    assert.ok(findService(services, "myapp--scheduler"));
  });

  it("each container carries per-unit strategy override", () => {
    const manifest = makeManifest({
      name: "myapp",
      strategy: { type: "blue-green", queue: true },
      containers: [
        { name: "api", port: 3000 },
        { name: "worker", port: 3001, strategy: { type: "recreate" } },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/myapp");

    const api = findService(services, "myapp--api")!;
    const worker = findService(services, "myapp--worker")!;

    assert.deepStrictEqual(api.strategy, { type: "blue-green", queue: true });
    assert.deepStrictEqual(worker.strategy, { type: "recreate" });
  });

  it("each container carries per-unit rateLimit override", () => {
    const manifest = makeManifest({
      name: "myapp",
      rateLimit: { requestsPerMinute: 120 },
      containers: [
        { name: "api", port: 3000 },
        { name: "worker", port: 3001, rateLimit: { requestsPerMinute: 30 } },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/myapp");

    assert.deepStrictEqual(
      findService(services, "myapp--api")!.rateLimit,
      { requestsPerMinute: 120 },
    );
    assert.deepStrictEqual(
      findService(services, "myapp--worker")!.rateLimit,
      { requestsPerMinute: 30 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Sidecars
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — sidecars", () => {
  it("resolves sidecar name references into SidecarConfig objects", () => {
    const manifest = makeManifest({
      name: "groupthink",
      containers: [
        {
          name: "groupthink",
          port: 3000,
          sidecars: ["db", "redis"],
        },
      ],
      sidecars: [
        { name: "db", image: "docker.io/postgres:16-alpine", port: 5432 },
        { name: "redis", image: "docker.io/redis:7-alpine", port: 6379, canarySafe: true },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/groupthink");
    assert.strictEqual(services.length, 1);
    const sidecars = services[0].container?.sidecars;
    assert.ok(sidecars);
    assert.strictEqual(sidecars.length, 2);

    const db = sidecars.find((s) => s.name === "db")!;
    assert.strictEqual(db.image, "docker.io/postgres:16-alpine");
    assert.strictEqual(db.port, 5432);

    const redis = sidecars.find((s) => s.name === "redis")!;
    assert.strictEqual(redis.image, "docker.io/redis:7-alpine");
    assert.strictEqual(redis.canarySafe, true);
  });

  it("throws when a sidecar reference is missing from the manifest", () => {
    const manifest = makeManifest({
      name: "bad",
      containers: [{ name: "bad", port: 3000, sidecars: ["nonexistent"] }],
    });
    assert.throws(
      () => normalizeManifest(manifest, "/repos/bad"),
      /sidecar "nonexistent" referenced but not defined/,
    );
  });

  it("shared sidecar is inlined into all referencing containers", () => {
    const manifest = makeManifest({
      name: "myapp",
      containers: [
        { name: "api", port: 3000, sidecars: ["db"] },
        { name: "worker", port: 3001, sidecars: ["db"] },
      ],
      sidecars: [
        { name: "db", image: "docker.io/postgres:16", port: 5432 },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/myapp");
    assert.strictEqual(services.length, 2);

    const apiSidecars = findService(services, "myapp--api")!.container!.sidecars!;
    const workerSidecars = findService(services, "myapp--worker")!.container!.sidecars!;
    assert.strictEqual(apiSidecars.length, 1);
    assert.strictEqual(workerSidecars.length, 1);
    assert.strictEqual(apiSidecars[0].name, "db");
    assert.strictEqual(workerSidecars[0].name, "db");
  });

  it("standalone sidecar (not referenced) becomes its own Service", () => {
    const manifest = makeManifest({
      name: "infra",
      sidecars: [
        { name: "metrics", image: "docker.io/prom/prometheus:latest", port: 9090 },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/infra");
    assert.strictEqual(services.length, 1);
    assert.strictEqual(services[0].name, "infra--metrics");
    assert.ok(services[0].container?.sidecars);
    assert.strictEqual(services[0].container!.sidecars![0].name, "metrics");
    assert.strictEqual(services[0].container!.sidecars![0].image, "docker.io/prom/prometheus:latest");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — APK units
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — APK units", () => {
  it("produces a containerless Service with apkBuild set", () => {
    const manifest = makeManifest({
      name: "talaria",
      containers: [
        { name: "talaria", port: 8321 },
      ],
      apks: [
        {
          name: "talaria-app",
          packageName: "com.reedsutliff.talaria",
          path: "android",
          task: "assembleDebug",
          buildType: "debug",
          destDir: "Talaria",
          extraProps: { talariaWsUrl: "wss://talaria.ffilt.us/v1/ptt" },
        },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/talaria");
    assert.strictEqual(services.length, 2);

    const apkService = findService(services, "talaria--apk-talaria-app")!;
    assert.ok(apkService);
    assert.strictEqual(apkService.container, null);
    assert.strictEqual(apkService.service, null);
    assert.strictEqual(apkService.expose, null);
    assert.deepStrictEqual(apkService.apkBuild, {
      packageName: "com.reedsutliff.talaria",
      type: undefined,
      path: "android",
      task: "assembleDebug",
      buildType: "debug",
      destDir: "Talaria",
      extraProps: { talariaWsUrl: "wss://talaria.ffilt.us/v1/ptt" },
    });
  });

  it("APK-only manifest (no containers) works", () => {
    const manifest = makeManifest({
      name: "android-lib",
      apks: [
        { name: "lib", packageName: "com.example.lib", path: "android" },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/android-lib");
    assert.strictEqual(services.length, 1);
    assert.strictEqual(services[0].name, "android-lib--apk-lib");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Systemd units
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — systemd units", () => {
  it("produces a containerless Service with service set", () => {
    const manifest = makeManifest({
      name: "files",
      expose: {
        enabled: true,
        hostname: "files.ffilt.us",
        tunnel: "ca308a1b-...",
      },
      systemd: [
        {
          name: "serve",
          type: "simple",
          execStart: "node /srv/agent-stack/repos/files/server.mjs",
          port: 3650,
          user: "root",
          restart: "always",
          env: { PORT: "3650", HOST: "0.0.0.0" },
        },
      ],
    });
    const services = normalizeManifest(manifest, "/repos/files");
    assert.strictEqual(services.length, 1);
    const svc = services[0];
    assert.strictEqual(svc.name, "files--serve");
    assert.strictEqual(svc.container, null);
    assert.deepStrictEqual(svc.service, {
      type: "simple",
      exec_start: "node /srv/agent-stack/repos/files/server.mjs",
      exec_reload: undefined,
      port: 3650,
      user: "root",
      restart: "always",
      env: { PORT: "3650", HOST: "0.0.0.0" },
    });
    assert.deepStrictEqual(svc.expose, {
      enabled: true,
      hostname: "files.ffilt.us",
      hostnames: undefined,
      tunnel: "ca308a1b-...",
    });
  });

  it("systemd units inherit top-level expose", () => {
    const manifest = makeManifest({
      name: "mysvc",
      expose: {
        enabled: true,
        hostname: "mysvc.ffilt.us",
      },
      systemd: [
        { name: "web", execStart: "node app.js", port: 3000 },
      ],
    });
    const svc = normalizeManifest(manifest, "/repos/mysvc")[0];
    assert.ok(svc.expose);
    assert.strictEqual(svc.expose!.hostname, "mysvc.ffilt.us");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Expose merging
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — expose merging", () => {
  it("container inherits top-level expose", () => {
    const manifest = makeManifest({
      name: "app",
      expose: {
        enabled: true,
        hostname: "app.ffilt.us",
        tunnel: "tunnel-id",
      },
      containers: [{ name: "app", port: 3000 }],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.deepStrictEqual(svc.expose, {
      enabled: true,
      hostname: "app.ffilt.us",
      hostnames: undefined,
      tunnel: "tunnel-id",
    });
  });

  it("container overrides hostname", () => {
    const manifest = makeManifest({
      name: "app",
      expose: { enabled: true, hostname: "app.ffilt.us", tunnel: "tun" },
      containers: [
        { name: "api", port: 3000, expose: { hostname: "api.app.ffilt.us" } },
      ],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.strictEqual(svc.expose!.hostname, "api.app.ffilt.us");
    assert.strictEqual(svc.expose!.tunnel, "tun"); // inherited
  });

  it("container disables exposure", () => {
    const manifest = makeManifest({
      name: "app",
      expose: { enabled: true, hostname: "app.ffilt.us" },
      containers: [
        { name: "worker", port: 3000, expose: { disabled: true } },
      ],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.strictEqual(svc.expose, null);
  });

  it("container sets tunnel to null (inherit)", () => {
    const manifest = makeManifest({
      name: "app",
      expose: { enabled: true, hostname: "app.ffilt.us", tunnel: "top-tunnel" },
      containers: [
        { name: "api", port: 3000, expose: { hostname: "api.app.ffilt.us", tunnel: null } },
      ],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.strictEqual(svc.expose!.tunnel, "top-tunnel");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Top-level defaults
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — top-level defaults", () => {
  it("propagates secrets to all containers", () => {
    const manifest = makeManifest({
      name: "app",
      secrets: ["API_KEY", "DB_PASSWORD"],
      containers: [
        { name: "app", port: 3000 },
      ],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.deepStrictEqual(svc.secrets, ["API_KEY", "DB_PASSWORD"]);
  });

  it("propagates logo to all containers", () => {
    const manifest = makeManifest({
      name: "app",
      logo: { _type: "file", fileName: ".logo.svg", isRelative: true },
      containers: [{ name: "app", port: 3000 }],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.deepStrictEqual(svc.logo, {
      _type: "file",
      fileName: ".logo.svg",
      isRelative: true,
    });
  });

  it("propagates privileged flag", () => {
    const manifest = makeManifest({
      name: "app",
      privileged: true,
      containers: [{ name: "app", port: 3000 }],
    });
    const svc = normalizeManifest(manifest, "/repos/app")[0];
    assert.strictEqual(svc.privileged, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// normalizeManifest — Full migration examples
// ═══════════════════════════════════════════════════════════════════════

describe("normalizeManifest — Talaria migration (container + APK)", () => {
  it("produces correct services from the Talaria v4 manifest", () => {
    const manifest: RepoManifest = {
      version: 4,
      name: "talaria",
      strategy: { type: "blue-green", queue: true },
      rateLimit: { requestsPerMinute: 120 },
      expose: { enabled: true, hostname: "talaria.ffilt.us", tunnel: "ca308a1b-test" },
      secrets: ["HERMES_API_KEY"],
      containers: [
        {
          name: "talaria",
          watch: ["src/**", "package.json", "Containerfile"],
          port: 8321,
          autoPort: true,
          containerfile: "Containerfile",
          build: { network: "host", podmanArgs: "--memory 2g" },
          podmanArgs: "--memory 2g",
          env: { HOST: "0.0.0.0", PORT: "8321", HERMES_API_KEY: "{SECRETS.HERMES_API_KEY}" },
          volumes: ["talaria-cache:/app/cache"],
          healthCheck: { path: "/health", timeout: 15000 },
        },
      ],
      apks: [
        {
          name: "talaria-app",
          watch: ["android/**", "gradle/**"],
          packageName: "com.reedsutliff.talaria",
          path: "android",
          task: "assembleDebug",
          buildType: "debug",
          destDir: "Talaria",
          extraProps: { talariaWsUrl: "wss://talaria.ffilt.us/v1/ptt" },
        },
      ],
    };

    const services = normalizeManifest(manifest, "/srv/agent-stack/repos/talaria");

    // Container service
    const container = findService(services, "talaria")!;
    assert.ok(container, "talaria container service exists");
    assert.strictEqual(container.name, "talaria");
    assert.strictEqual(container.container?.port, 8321);
    assert.strictEqual(container.container?.auto_port, true);
    assert.strictEqual(container.container?.healthCheck?.path, "/health");
    assert.deepStrictEqual(container.build, { network: "host", podman_args: "--memory 2g", containerfile: "Containerfile" });
    assert.deepStrictEqual(container.strategy, { type: "blue-green", queue: true });
    assert.deepStrictEqual(container.rateLimit, { requestsPerMinute: 120 });
    assert.strictEqual(container.expose?.hostname, "talaria.ffilt.us");

    // APK service
    const apk = findService(services, "talaria--apk-talaria-app")!;
    assert.ok(apk, "talaria APK service exists");
    assert.strictEqual(apk.container, null);
    assert.strictEqual(apk.apkBuild?.packageName, "com.reedsutliff.talaria");
    assert.strictEqual(apk.apkBuild?.path, "android");
  });
});

describe("normalizeManifest — Groupthink migration (container + sidecars)", () => {
  it("produces correct services from the Groupthink v4 manifest", () => {
    const manifest: RepoManifest = {
      version: 4,
      name: "groupthink",
      strategy: { type: "blue-green", queue: true, canary: { observationPeriodMs: 300000, maxErrorCount: 5 } },
      expose: { enabled: true, hostname: "groupthink.ffilt.us", tunnel: "tunnel-id" },
      secrets: ["IDP_GOOGLE_GROUPTHINK_CLIENT_ID", "IDP_GOOGLE_GROUPTHINK_CLIENT_SECRET"],
      containers: [
        {
          name: "groupthink",
          watch: ["src/**", "package.json", "Containerfile", "prisma/**"],
          port: 3000,
          autoPort: true,
          env: {
            DATABASE_URL: "postgres://groupthink:***@groupthink--db:5432/groupthink",
            REDIS_URL: "redis://groupthink--redis:6379",
          },
          volumes: ["/srv/agent-stack/config/groupthink:/config"],
          sidecars: ["db", "redis"],
          healthCheck: { path: "/health/live" },
        },
      ],
      sidecars: [
        {
          name: "db",
          image: "docker.io/postgres:16-alpine",
          port: 5432,
          env: { POSTGRES_USER: "groupthink", POSTGRES_PASSWORD: "groupthink", POSTGRES_DB: "groupthink" },
          volumes: ["groupthink-pgdata:/var/lib/postgresql/data"],
        },
        {
          name: "redis",
          image: "docker.io/redis:7-alpine",
          port: 6379,
          volumes: ["groupthink-redis-data:/data"],
          command: ["redis-server", "/usr/local/etc/redis/redis.conf"],
        },
      ],
    };

    const services = normalizeManifest(manifest, "/srv/agent-stack/repos/groupthink");

    // Container service
    const container = findService(services, "groupthink")!;
    assert.ok(container);
    assert.strictEqual(container.container?.port, 3000);
    assert.strictEqual(container.expose?.hostname, "groupthink.ffilt.us");
    assert.deepStrictEqual(container.strategy, {
      type: "blue-green", queue: true,
      canary: { observationPeriodMs: 300000, maxErrorCount: 5 },
    });

    // Sidecars resolved
    const sidecars = container.container!.sidecars!;
    assert.strictEqual(sidecars.length, 2);
    assert.strictEqual(sidecars[0].name, "db");
    assert.strictEqual(sidecars[1].name, "redis");
    assert.strictEqual(sidecars[0].image, "docker.io/postgres:16-alpine");
    assert.strictEqual(sidecars[1].image, "docker.io/redis:7-alpine");

    // Sidecars are inlined — no standalone sidecar services
    assert.strictEqual(services.length, 1);
  });
});

describe("normalizeManifest — multi-container flagship example", () => {
  it("produces correct services for a 3-container + 1 APK repo", () => {
    const manifest: RepoManifest = {
      version: 4,
      name: "myapp",
      strategy: { type: "blue-green", queue: true },
      expose: { enabled: true, tunnel: "tunnel-id" },
      sidecars: [
        { name: "db", image: "docker.io/postgres:16-alpine", port: 5432, volumes: ["myapp-db:/var/lib/postgresql/data"] },
        { name: "redis", image: "docker.io/redis:7-alpine", port: 6379, canarySafe: true },
      ],
      containers: [
        {
          name: "api",
          containerfile: "Containerfile.api",
          watch: ["src/api/**", "src/shared/**", "package.json", "Containerfile.api"],
          port: 3000,
          sidecars: ["db", "redis"],
          expose: { hostname: "api.myapp.ffilt.us" },
          healthCheck: { path: "/health" },
        },
        {
          name: "worker",
          containerfile: "Containerfile.worker",
          watch: ["src/worker/**", "src/shared/**", "Containerfile.worker"],
          port: 3001,
          sidecars: ["db", "redis"],
          strategy: { type: "recreate" },
          expose: { disabled: true },
        },
        {
          name: "scheduler",
          containerfile: "Containerfile.scheduler",
          watch: ["src/scheduler/**", "src/shared/**", "Containerfile.scheduler"],
          port: 3002,
          sidecars: ["db"],
          strategy: { type: "recreate" },
          expose: { disabled: true },
        },
      ],
      apks: [
        {
          name: "myapp-android",
          packageName: "com.example.myapp",
          path: "android",
          watch: ["android/**", "src/shared/types/**"],
          buildType: "release",
          task: "assembleRelease",
        },
      ],
    };

    const services = normalizeManifest(manifest, "/repos/myapp");

    // 3 containers + 1 APK = 4 services
    assert.strictEqual(services.length, 4);

    // API
    const api = findService(services, "myapp--api")!;
    assert.ok(api);
    assert.strictEqual(api.container?.port, 3000);
    assert.strictEqual(api.expose?.hostname, "api.myapp.ffilt.us");
    assert.strictEqual(api.expose?.tunnel, "tunnel-id");
    assert.deepStrictEqual(api.strategy, { type: "blue-green", queue: true });
    assert.strictEqual(api.container!.sidecars!.length, 2);

    // Worker
    const worker = findService(services, "myapp--worker")!;
    assert.ok(worker);
    assert.strictEqual(worker.container?.port, 3001);
    assert.strictEqual(worker.expose, null); // disabled
    assert.deepStrictEqual(worker.strategy, { type: "recreate" });
    assert.strictEqual(worker.container!.sidecars!.length, 2);

    // Scheduler
    const sched = findService(services, "myapp--scheduler")!;
    assert.ok(sched);
    assert.strictEqual(sched.container?.port, 3002);
    assert.strictEqual(sched.expose, null);
    assert.strictEqual(sched.container!.sidecars!.length, 1);

    // APK
    const apk = findService(services, "myapp--apk-myapp-android")!;
    assert.ok(apk);
    assert.strictEqual(apk.apkBuild?.packageName, "com.example.myapp");
    assert.strictEqual(apk.apkBuild?.buildType, "release");
  });
});
