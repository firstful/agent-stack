/**
 * Auth context and provider for the Groupthink Expo app.
 *
 * Manages authentication state across the app. Uses expo-web-browser
 * for OAuth flow (Google, GitHub, Apple) and exchanges the auth code
 * with the Groupthink backend.
 *
 * Authentication flow:
 *   1. User taps OAuth button → `signIn(provider)` opens system browser
 *   2. Provider redirects to Groupthink callback URL → backend handles exchange
 *   3. Backend redirects back to app with userId in the redirect URL
 *   4. User profile is stored in context, navigation switches to Main tabs
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

// ── Types ──

export type AuthProvider = "google" | "github" | "apple";

export interface AuthUser {
  id: string;
  username: string;
  provider: AuthProvider;
  email: string | null;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  /** True when a user is signed in. */
  isAuthenticated: boolean;
  /** True while an OAuth flow or token exchange is in flight. */
  isLoading: boolean;
  /** Error message from the last failed sign-in attempt, if any. */
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** The current user's UUID, suitable for the x-user-id header. */
  userId: string | null;
  /** Initiate sign-in with an OAuth provider. */
  signIn: (provider: AuthProvider) => Promise<void>;
  /** Complete a pending sign-in with the OAuth callback data. */
  completeSignIn: (userId: string, username: string) => void;
  /** Sign out the current user. */
  signOut: () => void;
  /** Clear any auth error. */
  clearError: () => void;
}

// ── Constants ──

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const USE_MOCK = process.env.EXPO_PUBLIC_AUTH_MOCK === "true";

// ── Context ──

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Warm up the browser session for faster OAuth opening ──

WebBrowser.warmUpAsync();

// ── Mock helpers (development / no server) ──

/**
 * Simulate opening an OAuth provider's auth URL.
 */
async function mockOpenOAuthSession(provider: AuthProvider): Promise<{
  code: string;
  providerId: string;
}> {
  await new Promise((r) => setTimeout(r, 600));
  return {
    code: `mock_auth_code_${provider}_${Date.now()}`,
    providerId: `provider_${provider}_${Math.random().toString(36).slice(2, 10)}`,
  };
}

/**
 * Simulate exchanging the OAuth code with the Groupthink backend.
 * POST /api/auth/register with { provider, providerId, username }
 * Returns { id, username, provider, email, avatarUrl }
 */
async function mockExchangeCodeForSession(
  provider: AuthProvider,
  providerId: string,
  username: string,
): Promise<AuthUser> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, providerId, username }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sign-in failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  return {
    id: data.id ?? data.userId,
    username: data.username ?? username,
    provider: data.provider ?? provider,
    email: data.email ?? null,
    avatarUrl: data.avatarUrl ?? null,
  };
}

// ── Provider ──

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Full OAuth flow:
   *   1. Open the backend's OAuth initiation URL in system browser
   *   2. The backend handles the provider-specific OAuth dance
   *   3. Backend redirects back to the app via deep link with userId
   *   4. Parse the userId from the redirect URL and set user state
   *
   * When EXPO_PUBLIC_AUTH_MOCK=true, runs mock in-memory flow instead.
   */
  const signIn = useCallback(async (provider: AuthProvider) => {
    setIsLoading(true);
    setError(null);

    try {
      if (USE_MOCK || Platform.OS === "web") {
        // Mock/Optimistic flow (web handles OAuth via regular redirect)
        const { code, providerId } = await mockOpenOAuthSession(provider);
        const suggestedUsername =
          provider.charAt(0).toUpperCase() + provider.slice(1) + "User";
        const authUser = await mockExchangeCodeForSession(
          provider,
          providerId,
          suggestedUsername,
        );
        setUser(authUser);
      } else {
        // Real OAuth flow via expo-web-browser
        // The app redirects to our backend which handles the provider OAuth dance.
        // On completion, the backend redirects back to groupthink://auth/callback
        // with userId and username as query params.
        const redirectUri = Linking.createURL("auth/callback");

        const authUrl = `${BASE}/api/auth/${provider}?redirect_uri=${encodeURIComponent(redirectUri)}`;

        const result = await WebBrowser.openAuthSessionAsync(
          authUrl,
          redirectUri,
          { preferEphemeralSession: true },
        );

        if (result.type === "success" && result.url) {
          // Parse the userId from the redirect URL
          // Expected: groupthink://auth/callback?userId=xxx&username=yyy
          const url = new URL(result.url);
          const userId = url.searchParams.get("userId");
          const username = url.searchParams.get("username");

          if (userId && username) {
            completeSignIn(userId, username);
          } else {
            throw new Error("Missing userId or username in OAuth callback");
          }
        } else if (
          result.type === "cancel" ||
          result.type === "dismiss"
        ) {
          // User cancelled — not an error
          setIsLoading(false);
          return;
        } else {
          throw new Error(
            `OAuth failed: ${result.type}`,
          );
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "OAuth sign-in failed";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
    // completeSignIn is stable — defined below, never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Bypass the OAuth flow (used for development or when the backend
   * has already exchanged the token — e.g. deep-link callback).
   */
  const completeSignIn = useCallback(
    (userId: string, username: string) => {
      setUser({
        id: userId,
        username,
        provider: "google",
        email: null,
        avatarUrl: null,
      });
      setIsLoading(false);
    },
    [],
  );

  const signOut = useCallback(() => {
    setUser(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      userId: user?.id ?? null,
      signIn,
      completeSignIn,
      signOut,
      clearError,
    }),
    [user, isLoading, error, signIn, completeSignIn, signOut, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
