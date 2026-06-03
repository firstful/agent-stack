"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { exchangeOAuthCode, useAuth, type OAuthProviderId } from "@/lib/auth";

export default function OAuthCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login, state } = useAuth();

  const provider = params.provider as string;
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  const [status, setStatus] = useState<"exchanging" | "redirecting" | "done" | "error">("exchanging");
  const [error, setError] = useState("");

  const handleCallback = useCallback(async () => {
    if (errorParam) {
      setError(errorParam);
      setStatus("error");
      return;
    }

    if (!code) {
      setError("No authorization code received from provider.");
      setStatus("error");
      return;
    }

    // Validate provider
    const validProviders = ["google", "github", "apple"];
    if (!validProviders.includes(provider)) {
      setError(`Unknown OAuth provider: "${provider}".`);
      setStatus("error");
      return;
    }

    try {
      setStatus("exchanging");
      const { token, user } = await exchangeOAuthCode(provider as OAuthProviderId, code);
      // Store session via AuthProvider
      login(token, user);
      setStatus("redirecting");
      // Redirect to home after a brief delay so the state settles
      setTimeout(() => router.replace("/"), 300);
    } catch (err: any) {
      const msg = err?.message ?? "OAuth exchange failed. Please try signing in again.";
      setError(msg);
      setStatus("error");
    }
  }, [code, errorParam, provider, login, router]);

  useEffect(() => {
    handleCallback();
  }, [handleCallback]);

  return (
    <div className="auth-fullscreen">
      <div className="auth-card">
        {status === "exchanging" && (
          <div className="auth-status">
            <div className="auth-spinner" />
            <p>Completing sign-in with {provider}...</p>
          </div>
        )}

        {status === "redirecting" && (
          <div className="auth-status">
            <div className="auth-spinner" />
            <p>Sign-in successful! Redirecting...</p>
          </div>
        )}

        {status === "done" && (
          <div className="auth-status">
            <span className="auth-icon-success">✓</span>
            <p>You&apos;re signed in.</p>
            <Link href="/" className="auth-btn-primary">
              Go to Feed
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="auth-status">
            <span className="auth-icon-error">✕</span>
            <h2>Sign-in failed</h2>
            <p className="auth-error-msg">{error}</p>
            <div className="auth-actions">
              <Link href="/login" className="auth-btn-primary">
                Try again
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
