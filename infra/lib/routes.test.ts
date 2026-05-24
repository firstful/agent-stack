import { describe, it } from "node:test";
import assert from "node:assert";
import { matchRoute, buildOpenApiSpec } from "./routes";

describe("matchRoute", () => {
  it("matches a simple GET route", () => {
    const result = matchRoute("GET", "/api/status");
    assert(result);
    assert.strictEqual(result.handlerName, "handleApiStatus");
    assert.deepStrictEqual(result.params, {});
  });

  it("matches a route with a path parameter", () => {
    const result = matchRoute("GET", "/api/services/opencode");
    assert(result);
    assert.strictEqual(result.handlerName, "handleApiServiceGet");
    assert.deepStrictEqual(result.params, { name: "opencode" });
  });

  it("matches a route with path parameter that has dashes", () => {
    const result = matchRoute("GET", "/api/services/kilocode-web");
    assert(result);
    assert.strictEqual(result.params.name, "kilocode-web");
  });

  it("matches an action route with path parameter", () => {
    const result = matchRoute("POST", "/api/services/opencode/restart");
    assert(result);
    assert.strictEqual(result.handlerName, "handleApiServiceRestart");
    assert.deepStrictEqual(result.params, { name: "opencode" });
  });

  it("returns null for unknown routes", () => {
    const result = matchRoute("GET", "/api/nonexistent");
    assert.strictEqual(result, null);
  });

  it("returns null for wrong method", () => {
    const result = matchRoute("DELETE", "/api/status");
    assert.strictEqual(result, null);
  });

  it("returns null for unmatched pattern", () => {
    const result = matchRoute("GET", "/");
    assert.strictEqual(result, null);
  });
});

describe("buildOpenApiSpec", () => {
  const spec = buildOpenApiSpec();

  it("returns valid OpenAPI 3.0.3 spec", () => {
    assert.strictEqual(spec.openapi, "3.0.3");
    assert.strictEqual(spec.info.title, "Agent-Stack Infrastructure API");
    assert.strictEqual(spec.info.version, "1.0.0");
  });

  it("includes all routes in paths", () => {
    assert.ok(spec.paths["/api/status"]);
    assert.ok(spec.paths["/api/services"]);
    assert.ok(spec.paths["/api/services/:name"]);
    assert.ok(spec.paths["/api/services/:name/start"]);
    assert.ok(spec.paths["/api/services/:name/stop"]);
    assert.ok(spec.paths["/api/services/:name/restart"]);
    assert.ok(spec.paths["/api/services/:name/rebuild"]);
    assert.ok(spec.paths["/api/reconcile"]);
    assert.ok(spec.paths["/api/logs/:name"]);
    assert.ok(spec.paths["/api/logs/analytics"]);
    assert.ok(spec.paths["/api/openapi.json"]);
  });

  it("has correct HTTP methods for each path", () => {
    assert.ok(spec.paths["/api/services"].get);
    assert.ok(spec.paths["/api/services"].post);
    assert.ok(spec.paths["/api/services/:name"].get);
    assert.ok(spec.paths["/api/services/:name"].put);
    assert.ok(spec.paths["/api/services/:name"].delete);
  });

  it("includes two servers", () => {
    assert.strictEqual(spec.servers.length, 2);
  });
});
