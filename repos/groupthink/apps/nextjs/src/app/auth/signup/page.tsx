"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  loadTurnstileScript,
  renderTurnstile,
  registerWithTurnstile,
  useAuth,
} from "@/lib/auth";

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA"; // invisible placeholder

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, state } = useAuth();

  const provider = searchParams.get("provider") ?? "";
  const providerId = searchParams.get("providerId") ?? "";

  const [username, setUsername] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"turnstile" | "form" | "submitting" | "done" | "error">("turnstile");
  const [error, setError] = useState("");

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileRendered = useRef(false);

  // Load Turnstile and render on mount
  useEffect(() => {
    if (!provider || !providerId) {
      setError("Missing account information. Please start again from the login page.");
      setStep("error");
      return;
    }

    loadTurnstileScript()
      .then(() => {
        if (turnstileContainerRef.current && !turnstileRendered.current) {
          turnstileRendered.current = true;
          return renderTurnstile("turnstile-container", TURNSTILE_SITE_KEY);
        }
        return Promise.reject(new Error("Container not ready"));
      })
      .then((token) => {
        setTurnstileToken(token);
        setStep("form");
      })
      .catch((err) => {
        if (err?.message === "Turnstile challenge expired") {
          setError("Verification expired. Please refresh the page.");
        } else {
          setError("Failed to load verification. Please try again.");
        }
        setStep("error");
      });
  }, [provider, providerId]);

  // If already authenticated, redirect away
  useEffect(() => {
    if (state.status === "authenticated") {
      router.replace("/");
    }
  }, [state.status, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      setError("Please complete the verification check.");
      return;
    }
    if (username.length < 2 || username.length > 30) {
      setError("Username must be between 2 and 30 characters.");
      return;
    }

    setLoading(true);
    setStep("submitting");
    setError("");

    try {
      const result = await registerWithTurnstile({
        provider,
        providerId,
        username,
        turnstileToken,
      });
      login(result.token, result.user);
      setStep("done");
      setTimeout(() => router.replace("/"), 500);
    } catch (err: any) {
      setError(err?.message ?? "Registration failed. Please try again.");
      setStep("form");
    } finally {
      setLoading(false);
    }
  };

  if (provider && providerId && step === "turnstile") {
    return (
      <div className="auth-fullscreen">
        <div className="auth-card">
          <div className="auth-status">
            <div className="auth-spinner" />
            <p>Loading verification...</p>
          </div>
          <div
            id="turnstile-container"
            ref={turnstileContainerRef}
            className="turnstile-wrapper"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-fullscreen">
      <div className="auth-card">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">
          Signed in via <strong>{provider}</strong> — pick a username to finish
          setting up your account.
        </p>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="standard-form">
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={30}
                placeholder="Choose a public username"
                autoFocus
                disabled={loading}
              />
              <span className="form-hint">2–30 characters, visible to everyone.</span>
            </label>

            {/* Hidden Turnstile container — already rendered above */}
            <div
              id="turnstile-container"
              ref={turnstileContainerRef}
              className="turnstile-wrapper"
            />

            {error && <p className="form-error">{error}</p>}

            <button type="submit" disabled={loading || !turnstileToken} className="auth-btn-primary">
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>
        )}

        {step === "submitting" && (
          <div className="auth-status">
            <div className="auth-spinner" />
            <p>Creating your account...</p>
          </div>
        )}

        {step === "done" && (
          <div className="auth-status">
            <span className="auth-icon-success">✓</span>
            <p>Account created! Redirecting...</p>
          </div>
        )}

        {step === "error" && (
          <div className="auth-status">
            <span className="auth-icon-error">✕</span>
            <p className="auth-error-msg">{error}</p>
            <div className="auth-actions">
              <Link href="/login" className="auth-btn-primary">
                Back to login
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
