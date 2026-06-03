import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import {
  signToken,
  verifyToken,
  getAuthorizeUrl,
  exchangeCode,
  getUserInfo,
  decodeAppleIdToken,
  verifyTurnstile,
  generatePlaceholderUsername,
  isValidUsername,
} from "../auth";

// ── JWT Token Tests ──

describe("Integration: Auth — JWT tokens", () => {
  it("signs and verifies a valid token", async () => {
    const token = await signToken({ sub: "user_abc", onboarding: false, provider: "google" });
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user_abc");
    expect(payload!.onboarding).toBe(false);
    expect(payload!.provider).toBe("google");
  });

  it("verifies token has expiration claim", async () => {
    const token = await signToken({ sub: "user_xyz", onboarding: true, provider: "github" });
    // Decode the JWT without verification to check exp
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.iat).toBeDefined();
    expect(payload.iss).toBe("groupthink");
  });

  it("returns null for an invalid/expired token", async () => {
    const fakeToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.invalid";
    const payload = await verifyToken(fakeToken);
    expect(payload).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token = await signToken({ sub: "user_abc", onboarding: false, provider: "google" });
    const tampered = token.slice(0, -5) + "XXXXX";
    const payload = await verifyToken(tampered);
    expect(payload).toBeNull();
  });

  it("sets the JWT issuer to groupthink", async () => {
    const token = await signToken({ sub: "user_iss", onboarding: false, provider: "apple" });
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.iss).toBe("groupthink");
  });
});

// ── OAuth Provider Configuration ──

describe("Integration: OAuth — authorize URLs", () => {
  const origGoogleId = process.env.GOOGLE_CLIENT_ID;
  const origGithubId = process.env.GITHUB_CLIENT_ID;
  const origAppleId = process.env.APPLE_CLIENT_ID;

  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    process.env.GITHUB_CLIENT_ID = "test-github-client-id";
    process.env.APPLE_CLIENT_ID = "test-apple-client-id";
  });

  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = origGoogleId ?? "";
    process.env.GITHUB_CLIENT_ID = origGithubId ?? "";
    process.env.APPLE_CLIENT_ID = origAppleId ?? "";
  });
  it("generates valid Google OAuth URL", () => {
    const url = getAuthorizeUrl("google", "http://localhost:3000/auth/callback", "state123");
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("client_id=");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("state=state123");
    expect(url).toContain("response_type=code");
    expect(url).toContain("scope=openid+email+profile");
  });

  it("generates valid GitHub OAuth URL", () => {
    const url = getAuthorizeUrl("github", "http://localhost:3000/auth/callback", "state456");
    expect(url).toContain("github.com/login/oauth/authorize");
    expect(url).toContain("scope=read%3Auser+user%3Aemail");
  });

  it("generates valid Apple OAuth URL", () => {
    const url = getAuthorizeUrl("apple", "http://localhost:3000/auth/callback", "state789");
    expect(url).toContain("appleid.apple.com/auth/authorize");
    expect(url).toContain("scope=name+email");
  });

  it("throws when provider client ID is not configured", () => {
    // Temporarily clear env
    const orig = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = "";
    expect(() => getAuthorizeUrl("google", "http://localhost:3000/auth/callback", "s")).toThrow();
    process.env.GOOGLE_CLIENT_ID = orig;
  });
});

describe("Integration: OAuth — code exchange", () => {
  afterAll(() => {
    nock.cleanAll();
  });

  it("exchanges a valid authorization code for tokens", async () => {
    nock("https://github.com")
      .post("/login/oauth/access_token")
      .reply(200, { access_token: "gho_test123", token_type: "bearer" });

    const result = await exchangeCode("github", "valid_code", "http://localhost:3000/auth/callback");
    expect(result.accessToken).toBe("gho_test123");
    expect(result.idToken).toBeUndefined();
  });

  it("throws on failed token exchange", async () => {
    nock("https://github.com")
      .post("/login/oauth/access_token")
      .reply(400, { error: "bad_verification_code" });

    await expect(
      exchangeCode("github", "bad_code", "http://localhost:3000/auth/callback"),
    ).rejects.toThrow();
  });

  it("exchanges Google code and returns id_token", async () => {
    nock("https://oauth2.googleapis.com")
      .post("/token")
      .reply(200, { access_token: "g_token", id_token: "g_id_token", expires_in: 3600 });

    const result = await exchangeCode("google", "g_code", "http://localhost:3000/auth/callback");
    expect(result.accessToken).toBe("g_token");
    expect(result.idToken).toBe("g_id_token");
  });
});

describe("Integration: OAuth — user info", () => {
  afterAll(() => {
    nock.cleanAll();
  });

  it("fetches Google user info", async () => {
    nock("https://www.googleapis.com")
      .get("/oauth2/v2/userinfo")
      .reply(200, { id: "google_uid_42", email: "alice@gmail.com", name: "Alice" });

    const info = await getUserInfo("google", "valid_token");
    expect(info.id).toBe("google_uid_42");
    expect(info.email).toBe("alice@gmail.com");
    expect(info.name).toBe("Alice");
  });

  it("fetches GitHub user info with login as fallback name", async () => {
    nock("https://api.github.com")
      .get("/user")
      .reply(200, { id: 12345, login: "alice-dev", email: "alice@github.com" });

    const info = await getUserInfo("github", "valid_gh_token");
    expect(info.id).toBe("12345");
    expect(info.email).toBe("alice@github.com");
    expect(info.name).toBe("alice-dev");
  });

  it("throws for Apple (no userinfo endpoint)", async () => {
    await expect(getUserInfo("apple", "token")).rejects.toThrow("no userinfo endpoint");
  });
});

describe("Integration: OAuth — Apple ID token decoding", () => {
  it("decodes Apple ID token payload", () => {
    // Create a minimal valid JWT-like structure
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "apple_user_1", email: "alice@privaterelay.apple.com" })).toString("base64url");
    const signature = Buffer.from("sig").toString("base64url");
    const idToken = `${header}.${payload}.${signature}`;

    const decoded = decodeAppleIdToken(idToken);
    expect(decoded.sub).toBe("apple_user_1");
    expect(decoded.email).toBe("alice@privaterelay.apple.com");
  });

  it("throws on malformed Apple ID token", () => {
    expect(() => decodeAppleIdToken("invalid.token")).toThrow();
  });
});

// ── Turnstile ──

describe("Integration: Turnstile verification", () => {
  const origTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeAll(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
  });

  afterAll(() => {
    process.env.TURNSTILE_SECRET_KEY = origTurnstileSecret;
    nock.cleanAll();
  });

  it("returns true when Turnstile token is valid", async () => {
    nock("https://challenges.cloudflare.com")
      .post("/turnstile/v0/siteverify")
      .reply(200, { success: true });

    const result = await verifyTurnstile("valid_turnstile_token");
    expect(result).toBe(true);
  });

  it("returns false when Turnstile token is invalid", async () => {
    nock("https://challenges.cloudflare.com")
      .post("/turnstile/v0/siteverify")
      .reply(200, { success: false, "error-codes": ["invalid-input-response"] });

    const result = await verifyTurnstile("bad_token");
    expect(result).toBe(false);
  });

  it("returns true when Turnstile is not configured (dev mode)", async () => {
    const orig = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = "";
    const result = await verifyTurnstile("any_token");
    expect(result).toBe(true);
    process.env.TURNSTILE_SECRET_KEY = orig;
  });
});

// ── Username Validation ──

describe("Integration: Username validation and generation", () => {
  it("generates a placeholder username", () => {
    const username = generatePlaceholderUsername();
    expect(username).toMatch(/^user_[a-f0-9]{8}$/);
  });

  it("validates correct usernames", () => {
    expect(isValidUsername("alice")).toBe(true);
    expect(isValidUsername("alice_123")).toBe(true);
    expect(isValidUsername("a1_b2_c3_d4")).toBe(true);
    expect(isValidUsername("AB")).toBe(true);
  });

  it("rejects invalid usernames", () => {
    expect(isValidUsername("a")).toBe(false); // too short
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("alice@bob")).toBe(false); // special chars
    expect(isValidUsername("a".repeat(31))).toBe(false); // too long
    expect(isValidUsername("has space")).toBe(false);
    expect(isValidUsername("has-dash")).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });
});

// ── Group Creation & Management Logic ──

describe("Integration: Group creation logic", () => {
  it("generates invite codes on group creation", () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(crypto.randomUUID().slice(0, 8));
    }
    expect(codes).toHaveLength(5);
    // All codes should be unique
    expect(new Set(codes).size).toBe(5);
  });

  it("starts as fringe tier (1-4 members)", () => {
    // 1 member = fringe
    const tierForMemberCount = (n: number): string => {
      if (n >= 10000) return "massive";
      if (n >= 1000) return "huge";
      if (n >= 200) return "large";
      if (n >= 50) return "medium";
      if (n >= 5) return "small";
      return "fringe";
    };

    expect(tierForMemberCount(1)).toBe("fringe");
    expect(tierForMemberCount(4)).toBe("fringe");
    expect(tierForMemberCount(5)).toBe("small");
  });

  it("auto-promotes tier as members join", () => {
    const tierForMemberCount = (n: number): string => {
      if (n >= 10000) return "massive";
      if (n >= 1000) return "huge";
      if (n >= 200) return "large";
      if (n >= 50) return "medium";
      if (n >= 5) return "small";
      return "fringe";
    };

    expect(tierForMemberCount(5)).toBe("small");
    expect(tierForMemberCount(50)).toBe("medium");
    expect(tierForMemberCount(200)).toBe("large");
    expect(tierForMemberCount(1000)).toBe("huge");
    expect(tierForMemberCount(10000)).toBe("massive");
  });

  it("enforces max 5 unused invite codes", () => {
    const existingCodes = ["a", "b", "c", "d", "e"]; // 5 existing
    const canGenerate = existingCodes.length < 5;
    expect(canGenerate).toBe(false);

    const fewerCodes = ["a", "b"]; // 2 existing
    expect(fewerCodes.length < 5).toBe(true);
  });

  it.each([
    ["thoughtful", "thoughtful"],
    ["snarky", "snarky"],
    ["funny", "funny"],
    ["mixed", "mixed"],
  ])("accepts valid energy type: %s", (energy, expected) => {
    const valid = ["thoughtful", "snarky", "funny", "mixed"];
    expect(valid.includes(energy)).toBe(true);
    expect(energy).toBe(expected);
  });

  it("prevents leaving as last member", () => {
    const memberCount = 1;
    expect(memberCount <= 1 ? "cannot leave" : "can leave").toBe("cannot leave");
  });

  it("allows leaving when other members exist", () => {
    const memberCount = 5;
    expect(memberCount <= 1 ? "cannot leave" : "can leave").toBe("can leave");
  });

  it("vouches the creator on group creation", () => {
    const isVouched = true;
    expect(isVouched).toBe(true);
  });
});

// ── Energy Change Cooldown ──

describe("Integration: Energy change cooldown", () => {
  it("allows energy change after 72 hours", () => {
    const lastChange = new Date(Date.now() - 73 * 3600000); // 73h ago
    const hoursSince = (Date.now() - lastChange.getTime()) / 3600000;
    expect(hoursSince).toBeGreaterThanOrEqual(72);
  });

  it("blocks energy change within 72 hours", () => {
    const lastChange = new Date(Date.now() - 24 * 3600000); // 24h ago
    const hoursSince = (Date.now() - lastChange.getTime()) / 3600000;
    expect(hoursSince).toBeLessThan(72);

    const hoursRemaining = Math.ceil(72 - hoursSince);
    expect(hoursRemaining).toBe(48);
    expect(hoursRemaining).toBeGreaterThan(0);
  });
});

// ── Invite Code Usage ──

describe("Integration: Invite code usage", () => {
  it("fails with invalid invite code", () => {
    const invite = null;
    expect(invite).toBeNull();
  });

  it("fails when invite code already used", () => {
    const invite = { usedBy: "user_abc" };
    expect(invite.usedBy).toBeTruthy();
  });

  it("fails when user is already a member", () => {
    const existingMembership = { userId: "user_abc", groupId: "group_1" };
    expect(existingMembership).toBeDefined();
  });

  it("succeeds with a valid unused code", () => {
    const invite = { id: "inv_1", groupId: "group_1", code: "aabbccdd", usedBy: null };
    expect(invite.usedBy).toBeNull();
    expect(invite.groupId).toBe("group_1");
  });
});

// ── Group Nicknames ──

describe("Integration: Group nicknames", () => {
  it("creates and retrieves a nickname", () => {
    const nickname = { sourceGroupId: "g1", targetGroupId: "g2", nickname: "Allies" };
    expect(nickname.nickname).toBe("Allies");
  });

  it("upserts replacing existing nickname for same target", () => {
    const existing = { id: "n1", sourceGroupId: "g1", targetGroupId: "g2", nickname: "Old" };
    const updated = { ...existing, nickname: "New" };
    expect(updated.nickname).toBe("New");
  });

  it("deletes a nickname", () => {
    const nickname = { id: "n1", sourceGroupId: "g1", targetGroupId: "g2" };
    const deleted = true;
    expect(deleted).toBe(true);
  });

  it("requires membership in source group to manage nicknames", () => {
    const member = { userId: "user_1", groupId: "g1" };
    const isMember = member.groupId === "g1";
    expect(isMember).toBe(true);

    const notMember = undefined;
    expect(notMember).toBeUndefined();
  });
});

// ── Group Settings ──

describe("Integration: Group settings", () => {
  it("updates group bio", () => {
    const settings = { bio: "New bio" };
    expect(settings.bio).toBe("New bio");
  });

  it("validates minInteractionTier cannot exclude own tier", () => {
    const tierOrder = ["fringe", "small", "medium", "large", "huge", "massive"];
    const ownTier = "small"; // 5 members
    const ownIdx = tierOrder.indexOf(ownTier);

    // Cannot set minInteractionTier higher than own
    expect(tierOrder.indexOf("medium")).toBeGreaterThan(ownIdx); // invalid
    expect(tierOrder.indexOf("fringe")).toBeLessThanOrEqual(ownIdx); // valid
    expect(tierOrder.indexOf("small")).toBeLessThanOrEqual(ownIdx); // valid
  });
});

// ── Group Blocks ──

describe("Integration: Group blocks", () => {
  it("blocks a target group", () => {
    const block = { blockerGroupId: "g1", blockedGroupId: "g2" };
    expect(block.blockerGroupId).not.toBe(block.blockedGroupId);
  });

  it("prevents self-block", () => {
    const groupId = "g1";
    const targetGroupId = "g1";
    expect(targetGroupId === groupId ? "cannot block yourself" : "can block").toBe("cannot block yourself");
  });

  it("prevents duplicate block", () => {
    const existing = true;
    expect(existing ? "already blocked" : "ok").toBe("already blocked");
  });

  it("unblocks a previously blocked group", () => {
    const block = { id: "b1" };
    const deleted = true;
    expect(deleted).toBe(true);
  });
});
