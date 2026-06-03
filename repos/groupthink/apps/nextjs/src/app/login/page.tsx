"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OAuthButton } from "@/components/OAuthButton";
import { OAUTH_PROVIDERS, useAuth } from "@/lib/auth";
import type { OAuthProviderId } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { state } = useAuth();

  // Already signed in → redirect to feed
  useEffect(() => {
    if (state.status === "authenticated") {
      router.replace("/");
    }
  }, [state.status, router]);

  if (state.status === "loading") {
    return (
      <div className="auth-fullscreen">
        <div className="auth-card">
          <div className="auth-status">
            <div className="auth-spinner" />
            <p>Checking session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "authenticated") {
    return null; // Will redirect; nothing to render
  }

  return (
    <div className="auth-fullscreen">
      <div className="auth-card">
        <h1 className="auth-title">Sign in to Groupthink</h1>
        <p className="auth-subtitle">
          A deliberative social platform where groups interact through structured,
          democratic communication.
        </p>

        <div className="oauth-button-group">
          {OAUTH_PROVIDERS.map((p) => (
            <OAuthButton key={p.id} provider={p.id as OAuthProviderId} />
          ))}
        </div>

        <p className="auth-divider">
          <span>or</span>
        </p>

        <div className="auth-alt-actions">
          <Link href="/join" className="auth-link">
            Have an invite code? Join a group
          </Link>
        </div>
      </div>
    </div>
  );
}
