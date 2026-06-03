"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";

type User = {
  id: string;
  username: string;
  oauthProvider: string;
  oauthId: string;
  createdAt: string;
  lastLoginAt: string;
};

export default function SettingsPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Username form
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const uid = localStorage.getItem("gt-user-id");
    if (!uid) {
      router.push("/login");
      return;
    }
    setUserId(uid);
    api
      .me()
      .then((u: User) => {
        setUser(u);
        setUsername(u.username);
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!username.trim() || username.trim().length < 2) {
        setError("Username must be at least 2 characters");
        return;
      }
      if (username.trim().length > 30) {
        setError("Username must be 30 characters or fewer");
        return;
      }
      setSaving(true);
      setError("");
      setSuccess("");
      try {
        const updated = await api.updateMe({ username: username.trim() });
        setUser(updated);
        setSuccess("Username updated successfully");
      } catch (err: any) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    },
    [username]
  );

  if (loading) {
    return (
      <AppShell>
        <div className="settings-view">
          <div className="skeleton skeleton-heading-xl" />
          <div className="skeleton skeleton-line skeleton-line--full" style={{ marginTop: 24 }} />
          <div className="skeleton skeleton-line skeleton-line--half" style={{ marginTop: 8 }} />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="settings-view">
          <p className="empty">Not signed in. <a href="/login">Sign in</a></p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="settings-view">
        <div className="settings-header">
          <h1>Account Settings</h1>
        </div>

        {/* User info card */}
        <div className="settings-card">
          <h2>Profile</h2>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">User ID</span>
              <span className="settings-info-value settings-mono">{user.id}</span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">OAuth Provider</span>
              <span className="settings-info-value">
                {user.oauthProvider.charAt(0).toUpperCase() + user.oauthProvider.slice(1)}
              </span>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Joined</span>
              <span className="settings-info-value">
                {new Date(user.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Username form */}
        <div className="settings-card">
          <h2>Username</h2>
          <p className="settings-description">
            Your username is how other groups see you. Must be 2–30 characters.
          </p>
          <form className="settings-form" onSubmit={handleSave}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              maxLength={30}
              minLength={2}
              required
            />
            {error && <p className="form-error">{error}</p>}
            {success && <p className="form-success">{success}</p>}
            <button type="submit" disabled={saving || username === user.username}>
              {saving ? "Saving..." : "Save Username"}
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
