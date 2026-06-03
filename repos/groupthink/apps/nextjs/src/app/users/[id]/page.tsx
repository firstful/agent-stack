"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";

type ProfileData = {
  user: {
    id: string;
    username: string;
    oauthProvider: string;
    createdAt: string;
    lastLoginAt: string | null;
    lastActiveAt: string | null;
    reputation: number;
  };
  groups: Array<{
    membershipId: string;
    groupId: string;
    groupName: string;
    groupEnergy: string;
    groupBio: string;
    isVouched: boolean;
    joinedAt: string;
    tenureDays: number;
  }>;
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    group: { id: string; name: string; energy: string } | null;
    status: string;
  }>;
  stats: {
    messagesBroadcast: number;
    votesCast: number;
    impulsesCreated: number;
  };
};

function tenureLabel(days: number): string {
  if (days >= 365) return "Veteran";
  if (days >= 90) return "Established";
  if (days >= 30) return "Regular";
  return "Newcomer";
}

function tenureColor(days: number): string {
  if (days >= 365) return "#d2a8ff";
  if (days >= 90) return "#58a6ff";
  if (days >= 30) return "#7ee787";
  return "#8b949e";
}

function tenureMax(days: number): number {
  if (days >= 365) return 365;
  if (days >= 90) return 90;
  if (days >= 30) return 30;
  return 30;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ReputationBadge({ value }: { value: number }) {
  let label = "New";
  let color = "#8b949e";
  if (value >= 100) { label = "Legend"; color = "#d2a8ff"; }
  else if (value >= 50) { label = "Esteemed"; color = "#f0883e"; }
  else if (value >= 20) { label = "Respected"; color = "#58a6ff"; }
  else if (value >= 10) { label = "Known"; color = "#7ee787"; }
  else if (value >= 3) { label = "Established"; color = "#d29922"; }

  return (
    <span
      className="reputation-badge"
      style={{
        "--rep-color": color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        color,
      } as React.CSSProperties}
    >
      <span className="reputation-icon">★</span>
      <span className="reputation-value">{value.toFixed(1)}</span>
      <span className="reputation-label">{label}</span>
    </span>
  );
}

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .userProfile(id)
      .then(setProfile)
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <AppShell>
        <div className="feed-view">
          <div className="form-error">{error}</div>
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell>
        <div className="profile-view">
          <div className="profile-header-skeleton">
            <div className="skeleton skeleton-avatar" />
            <div>
              <div className="skeleton skeleton-heading-xl" />
              <div className="skeleton skeleton-line" style={{ marginTop: 8 }} />
            </div>
          </div>
          <div style={{ height: 24 }} />
          <div className="skeleton skeleton-heading" />
          <div style={{ height: 12 }} />
          <div className="skeleton skeleton-line skeleton-line--full" />
          <div className="skeleton skeleton-line skeleton-line--full" />
          <div className="skeleton skeleton-line skeleton-line--half" />
        </div>
      </AppShell>
    );
  }

  const { user, groups, messages, stats } = profile;

  return (
    <AppShell>
      <div className="profile-view">
        {/* ── Profile Header ── */}
        <div className="profile-header">
          <div className="profile-avatar">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="profile-header-info">
            <h1 className="profile-username">{user.username}</h1>
            <div className="profile-meta">
              <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
              {user.lastActiveAt && (
                <span className="profile-last-active">
                  Active {timeAgo(user.lastActiveAt)}
                </span>
              )}
            </div>
            <div className="profile-badges">
              <ReputationBadge value={user.reputation} />
              <span className="provider-badge">{user.oauthProvider}</span>
            </div>
          </div>
        </div>

        {/* ── Stats ── */}
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.messagesBroadcast}</span>
            <span className="profile-stat-label">Messages</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.votesCast}</span>
            <span className="profile-stat-label">Votes</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.impulsesCreated}</span>
            <span className="profile-stat-label">Impulses</span>
          </div>
        </div>

        {/* ── Group Memberships ── */}
        <section className="profile-section">
          <h2>Groups ({groups.length})</h2>
          {groups.length === 0 ? (
            <p className="empty">No groups yet</p>
          ) : (
            <div className="profile-groups-list">
              {groups.map((g) => (
                <div key={g.membershipId} className="profile-group-card">
                  <div className="profile-group-info">
                    <Link
                      href={`/groups/${g.groupId}`}
                      className="profile-group-name"
                    >
                      {g.groupName}
                    </Link>
                    {g.groupBio && (
                      <p className="profile-group-bio">{g.groupBio}</p>
                    )}
                    <div className="profile-group-meta">
                      {g.groupEnergy && (
                        <span className="energy-badge">
                          <span className="energy-icon">⚡</span>
                          <span className="energy-label">{g.groupEnergy}</span>
                        </span>
                      )}
                      {g.isVouched && (
                        <span className="vouched-badge">Vouched</span>
                      )}
                    </div>
                  </div>
                  <div className="profile-group-tenure">
                    <div
                      className="tenure-days"
                      style={{ color: tenureColor(g.tenureDays) }}
                    >
                      {g.tenureDays}d
                    </div>
                    <div className="tenure-label">{tenureLabel(g.tenureDays)}</div>
                    <div className="tenure-bar-wrap">
                      <div
                        className="tenure-bar-fill"
                        style={{
                          width: `${Math.min(100, (g.tenureDays / tenureMax(g.tenureDays)) * 100)}%`,
                          background: tenureColor(g.tenureDays),
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Recent Messages ── */}
        <section className="profile-section">
          <h2>Recent Messages ({messages.length})</h2>
          {messages.length === 0 ? (
            <p className="empty">No messages yet</p>
          ) : (
            <div className="profile-messages-list">
              {messages.map((m) => (
                <Link
                  key={m.id}
                  href={`/impulses/${m.id}`}
                  className="profile-message-card"
                >
                  <div className="profile-message-header">
                    {m.group && (
                      <span className="group-name">{m.group.name}</span>
                    )}
                    <span className="timestamp">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="profile-message-content">{m.content}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
