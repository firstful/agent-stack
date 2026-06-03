import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomUUID } from "node:crypto";

// ── JWT Session Management ──

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "groupthink-dev-jwt-secret-change-in-production",
);
const JWT_ISSUER = "groupthink";
const JWT_EXPIRATION = "7d";

export interface SessionPayload {
  sub: string; // user UUID
  onboarding: boolean;
  provider: string;
}

export async function signToken(
  payload: Omit<SessionPayload, "iat" | "exp">,
): Promise<string> {
  return new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION)
    .setIssuer(JWT_ISSUER)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ── OAuth Provider Configuration ──

interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string | null;
  clientId: () => string;
  clientSecret: () => string;
  scope: string;
}

const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    clientId: () => process.env.GOOGLE_CLIENT_ID!,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET!,
    scope: "openid email profile",
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    clientId: () => process.env.GITHUB_CLIENT_ID!,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET!,
    scope: "read:user user:email",
  },
  apple: {
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    userInfoUrl: null, // Apple returns user info in the id_token JWT, not via API
    clientId: () => process.env.APPLE_CLIENT_ID!,
    clientSecret: () => process.env.APPLE_CLIENT_SECRET!,
    scope: "name email",
  },
};

export type OAuthProvider = "google" | "github" | "apple";

export function getAuthorizeUrl(
  provider: OAuthProvider,
  redirectUri: string,
  state: string,
): string {
  const config = OAUTH_CONFIGS[provider];
  if (!config.clientId()) {
    throw new Error(`${provider} client ID not configured`);
  }
  const params = new URLSearchParams({
    client_id: config.clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; idToken?: string }> {
  const config = OAUTH_CONFIGS[provider];
  const body = new URLSearchParams({
    client_id: config.clientId(),
    client_secret: config.clientSecret(),
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // GitHub requires Accept: application/json to return JSON
  if (provider === "github") {
    headers["Accept"] = "application/json";
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(
      `OAuth token exchange failed for ${provider}: ${JSON.stringify(data)}`,
    );
  }
  return { accessToken: data.access_token, idToken: data.id_token };
}

export async function getUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ id: string; email?: string; name?: string }> {
  const config = OAUTH_CONFIGS[provider];

  if (!config.userInfoUrl) {
    throw new Error(
      `${provider} has no userinfo endpoint; decode the id_token directly`,
    );
  }

  const res = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch user info from ${provider}: ${res.status} ${res.statusText}`,
    );
  }
  const data = await res.json();

  switch (provider) {
    case "google":
      return { id: data.id, email: data.email, name: data.name };
    case "github":
      return {
        id: String(data.id),
        email: data.email,
        name: data.name || data.login,
      };
    default:
      return { id: String(data.id), email: data.email, name: data.name };
  }
}

export function decodeAppleIdToken(
  idToken: string,
): { sub: string; email?: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid Apple ID token format");
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf-8"),
  );
  return { sub: payload.sub, email: payload.email };
}

// ── Cloudflare Turnstile ──

export async function verifyTurnstile(token: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    // If Turnstile is not configured, skip verification (dev mode)
    return true;
  }
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }).toString(),
    },
  );
  const data = await res.json();
  return data.success === true;
}

// ── Onboarding ──

export function generatePlaceholderUsername(): string {
  return `user_${randomUUID().slice(0, 8)}`;
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{2,30}$/.test(username);
}
