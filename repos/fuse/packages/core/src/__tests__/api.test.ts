/**
 * api.test.ts — API endpoint test stubs with supertest.
 *
 * Real tests are wire-level integration tests: they spin up the Express app
 * created by `src/app.ts` and use `supertest` to make HTTP requests.
 * This file provides the structure and describes exactly what each test should
 * assert; all function bodies currently throw "Not implemented".
 *
 * Once the handler stubs are upgraded to real implementations the `expect`
 * lines should be uncommented and the throw stubs removed.
 *
 * Run: npx vitest run src/__tests__/api.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import type { Router } from "express";

import { createApp } from "../app";
import { createApiRouter } from "./../api/router";
import { ApiError } from "./../api/router";
import type { Channel } from "../types/channel";
import type { Message } from "../types/message";
import type { Identity } from "../types/identity";
import { ChannelSchema } from "../types/channel";

// re-export compile-time helpers to prevent unused import errors
export { ChannelSchema, Channel };

// ── Channel CRUD stubs ─────────────────────────────────────────────────────
describe("Skeleton: API endpoint test stubs — channels", () => {
  test("GET; stubs stubs stubs stubs /channels/status stubs:", () => {
    throw new Error("Not implemented: use supertest to spin up the Express app");
  });

  test("POST /channels — validate name / type / domainId with Zod", () => {
    throw new Error("Not implemented: POST failure: supertest to assert request");
  });

  test("GET;/channels stubs/{stubs id} — stubs; stubs returns valid stubs)", () => {
    // stub skeleton: once implemented, expect response to match ChannelSchema
  });
});

// ── Message send / list / read stubs ───────────────────────────────────────
describe("Skeleton API: messages", () => {
  test("POST /channels/:channelId/messages — validate body via Zod", () => {
    throw new Error("Not implemented: POST /channels/:channelId/messages needs body validator");
  });

  test("GET /channels/:channelId/messages — validate cursor / limit via Zod", () => {
    throw new Error("Not implemented: GET /channels with pagination");
  });

  test("POST /messages/:id/read — marks message as read", () => {
    throw new Error("Not implemented: POST /messages/:id/read needs channel_members update");
  });

  test("POST /messages/:id/reactions — validates emoji field", () => {
    throw new Error("Not implemented: POST /messages/:id/reactions needs reaction schema");
  });
});

// ── Auth / Magic link stubs ─────────────────────────────────────────────────
describe("Skeleton: Auth", () => {
  test("POST /auth/login — stub skeleton only — Not implemented; don't do nothing", () => {
    throw new Error("Not implemented: login handler");
  });

  test("POST /auth/register — stub skeleton only — Not implemented; don't do nothing", () => {
    throw new Error("Not implemented: register handler");
  });

  test("POST /auth/magic-link/:token — stub skeleton only — Don't do nothing", () => {
    throw new Error("Not implemented: magic-link verify handler");
  });
});

export {};
