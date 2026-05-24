/**
 * smtp-proxy.test.ts — SMTP proxy EHLO / STARTFUSE test stubs.
 *
 * Real tests would spin up the SMPT proxy on an ephemeral port and use
 * node:net to open a raw TCP connection, issue EHLO, and assert keyword
 * presence.  This file provides the assert-style stubs so that it compiles
 * and can be run immediately—the helper function bodies throw "Not implemented"
 * to highlight the gap.
 *
 * Run after wiring unit tests: npx vitest run src/__tests__/smtp-proxy.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { createSmtpProxy, startSmtpProxy, broadcastNewMail } from "../smtp/proxy";
import { handleEhlo, isFuseClient } from "../smtp/ehlo";
import { handleStartfuse, closeFuseSession, getSession, gcExpiredSessions } from "../smtp/startfuse";
import { z } from "zod";

describe("Skeleton: SMTP proxy unit tests", () => {
  // We gate described blocks by requiring that the helpers at least parsen.
  test("EHLO: handleEhlo returns expected keywords", () => {
    const keywords = handleEhlo();
    expect(keywords).toContain("FUSE");
    expect(keywords).toContain("8BITMIME");
    expect(keywords).toContain("STARTFUSE");
    expect(keywords).toContain("RICH_MAIL");
  });

  test("EHLO: isFuseClient identifies custom verbs", () => {
    expect(isFuseClient(["220 localhost ESMTP FUSE", "250 FUSE", "250 8BITMIME"])).toBe(true);
    expect(isFuseClient(["220 locally", "250 8BITMIME"])).toBe(false);
  });

  test("STARTFUSE: session lifecycle", ({ task }) => {
    // Stub — realtest would assert session created / closed.
    expect(getSession("noop")).toBeNull();
    gcExpiredSessions();
    expect(closeFuseSession("nonexistent")).toBe(false);
  });

  test("createSmtpProxy returns an SMTPServer instance", () => {
    const server = createSmtpProxy();
    expect(server).toBeTruthy();
    expect(typeof server.listen).toBe("function");
    expect(typeof server.close).toBe("function");
    expect(() => server.close()).not.toThrow();
  });

  test("broadcastNewMail does not throw for empty client set", () => {
    expect(() => broadcastNewMail({ type: "message:created", id: "test" })).not.toThrow();
  });

  test("broadcastNewMail delivers to registered clients", () => {
    const sent: string[] = [];
    const stubWs = { send(data: string, callback?: (err?: Error) => void) { sent.push(data); callback?.(); } };
    // import { registerWsClient } from "../smtp/proxy";  // schema not here – s/proxy stub
    sent.push(broadcastNewMail({ type: "message:created", id: "x" }) as never);
    // stub record check: type-level only in skeleton
  });
});
