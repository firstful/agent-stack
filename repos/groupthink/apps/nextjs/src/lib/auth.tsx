"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ── Session storage keys ──
const STORAGE_TOKEN = "gt-auth-token";
const STORAGE_USER = "gt-auth-user";
const AUTH_COOKIE = "gt-auth";

// ── Cookie helpers (bridge for edge middleware) ──
function setAuthCookie(): void {
  try {
    document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  } catch {
    // Cookie unavailable — middleware can't protect, but auth still works in-memory
  }
}

function clearAuthCookie(): void {
  try {
    document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Best-effort cleanup
  }
}

// ── Types ──
export type AuthUser = {
  id: string;
  username: string;
  oauthProvider: string;
  createdAt: string;
  lastLoginAt: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser; token: string }
  | { status: "unauthenticated" };

type AuthContextValue = {
  state: AuthState;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  setUser: (user: AuthUser) => void;
  getToken: () => string | null;
};

// ── OAuth provider config ──
export const OAUTH_PROVIDERS = [
  {
    id: "google" as const,
    name: "Google",
    iconPath: "/auth/icons/google.svg",
    color: "#4285f4",
    hoverColor: "#3367d6",
  },
  {
    id: "github" as const,
    name: "GitHub",
    iconPath: "/auth/icons/github.svg",
    color: "#24292f",
    hoverColor: "#1b1f23",
  },
  {
    id: "apple" as const,
    name: "Apple",
    iconPath: "/auth/icons/apple.svg",
    color: "#000000",
    hoverColor: "#1a1a1a",
  },
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]["id"];

// ── API base ──
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// ── Initiate OAuth login — redirects to backend ──
export function initiateOAuth(provider: OAuthProviderId): void {
  const callbackUrl = `${window.location.origin}/auth/callback/${provider}`;
  window.location.href = `${API_BASE}/api/auth/${provider}?redirect=${encodeURIComponent(callbackUrl)}`;
}

// ── Exchange OAuth code for session ──
export async function exchangeOAuthCode(
  provider: OAuthProviderId,
  code: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(
    `${API_BASE}/api/auth/${provider}/callback?code=${encodeURIComponent(code)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ── Register with Turnstile verification ──
export async function registerWithTurnstile(data: {
  provider: string;
  providerId: string;
  username: string;
  turnstileToken: string;
}): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Registration failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ── Fetch current user from token ──
export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Session expired (${res.status})`);
  return res.json();
}

// ── Load Cloudflare Turnstile script ──
export function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).turnstile) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

// ── Render Turnstile widget into a container ──
export function renderTurnstile(
  containerId: string,
  siteKey: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tw = (window as any).turnstile;
    if (!tw) {
      reject(new Error("Turnstile not loaded"));
      return;
    }
    tw.render(`#${containerId}`, {
      sitekey: siteKey,
      callback: (token: string) => resolve(token),
      "expired-callback": () => reject(new Error("Turnstile challenge expired")),
    });
  });
}

// ── Context ──
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const token = localStorage.getItem(STORAGE_TOKEN);
      const raw = localStorage.getItem(STORAGE_USER);
      if (token && raw) {
        const user = JSON.parse(raw) as AuthUser;
        // Validate token by fetching /me — if it fails, clear session
        fetchMe(token)
          .then((freshUser) => {
            setState({ status: "authenticated", user: freshUser, token });
            localStorage.setItem(STORAGE_USER, JSON.stringify(freshUser));
          })
          .catch(() => {
            localStorage.removeItem(STORAGE_TOKEN);
            localStorage.removeItem(STORAGE_USER);
            setState({ status: "unauthenticated" });
          });
        return;
      }
    } catch {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
    }
    setState({ status: "unauthenticated" });
  }, []);

  const login = useCallback((token: string, user: AuthUser) => {
    try {
      localStorage.setItem(STORAGE_TOKEN, token);
      localStorage.setItem(STORAGE_USER, JSON.stringify(user));
      // Bridge: set legacy key for existing API client
      localStorage.setItem("gt-user-id", user.id);
    } catch {
      // localStorage full or unavailable — session survives in memory only
    }
    setAuthCookie();
    setState({ status: "authenticated", user, token });
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
      localStorage.removeItem("gt-user-id");
    } catch {
      // Ignore storage errors on cleanup
    }
    clearAuthCookie();
    setState({ status: "unauthenticated" });
  }, []);

  const setUser = useCallback((user: AuthUser) => {
    try {
      localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    } catch {
      // Memory-only update
    }
    setState((prev) =>
      prev.status === "authenticated"
        ? { ...prev, user }
        : { status: "authenticated", user, token: "" },
    );
  }, []);

  const getToken = useCallback((): string | null => {
    if (state.status === "authenticated") return state.token;
    try {
      return localStorage.getItem(STORAGE_TOKEN);
    } catch {
      return null;
    }
  }, [state]);

  return (
    <AuthContext.Provider value={{ state, login, logout, setUser, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
