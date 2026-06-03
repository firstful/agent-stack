"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type UserProfile = {
  id: string;
  username: string;
  oauthProvider: string;
  createdAt: string;
  reputation: number;
  memberCount: number;
};

type Membership = {
  id: string;
  groupId: string;
  groupName: string;
  groupEnergy: string;
  groupBio: string;
  joinedAt: string;
  tenureDays: number;
};

type ProfileData = {
  user: UserProfile;
  groups: Membership[];
  stats: {
    messagesBroadcast: number;
    votesCast: number;
    impulsesCreated: number;
  };
};

export default function MobileProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/users/me`)
      .then((r) => r.json())
      .then((data) => {
        setProfile(data);
        // Update groups with tenure info if not already present
        if (data.groups) {
          const enriched = data.groups.map((g: any) => ({
            ...g,
            groupId: g.groupId ?? g.group_id,
            groupName: g.groupName ?? g.group_name ?? g.name,
            groupEnergy: g.groupEnergy ?? g.energy,
            groupBio: g.groupBio ?? g.bio,
          }));
          setProfile({ ...data, groups: enriched });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mdot-feed">
        <div className="feed-loading" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          Loading profile…
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mdot-feed">
        <div className="feed-empty" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          Could not load profile
        </div>
      </div>
    );
  }

  const { user, groups, stats } = profile;
  const tenureDays = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / 86400000
  );

  return (
    <div className="mdot-profile">
      {/* Profile card */}
      <div className="mdot-profile-card">
        <div className="mdot-profile-avatar">
          {user.username?.charAt(0).toUpperCase() ?? "?"}
        </div>
        <div className="mdot-profile-name">{user.username}</div>
        <div className="mdot-profile-meta">
          {user.oauthProvider.charAt(0).toUpperCase() + user.oauthProvider.slice(1)} user
          {" · "}
          {tenureDays > 0 ? `${tenureDays}d old` : "New"}
        </div>
        <div className="mdot-profile-stats">
          <div className="stat">
            <span className="stat-value">{stats.messagesBroadcast}</span>
            <span className="stat-label">Messages</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.votesCast}</span>
            <span className="stat-label">Votes</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.impulsesCreated}</span>
            <span className="stat-label">Impulses</span>
          </div>
          <div className="stat">
            <span className="stat-value">{groups.length}</span>
            <span className="stat-label">Groups</span>
          </div>
        </div>
      </div>

      {/* Notification center link */}
      <Link href="/m/notifications" className="mdot-profile-link">
        <span>🔔</span>
        <span>Notification Center</span>
        <span>→</span>
      </Link>

      {/* Groups */}
      <div className="mdot-section-title">Groups ({groups.length})</div>
      {groups.length === 0 ? (
        <div style={{ padding: "16px 8px", color: "var(--text-muted)", textAlign: "center" }}>
          Not a member of any groups yet
        </div>
      ) : (
        <div className="mdot-group-list">
          {groups.map((g: any) => (
            <Link
              key={g.id ?? g.membershipId}
              href={`/m/groups/${g.groupId}`}
              className="mdot-group-row"
            >
              <div>
                <div className="mdot-group-row-name">{g.groupName}</div>
                {g.groupBio && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {g.groupBio}
                  </div>
                )}
              </div>
              <span className="mdot-group-card-tier">{g.groupEnergy}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Settings link */}
      <div style={{ marginTop: 24, padding: "0 8px" }}>
        <Link href="/m/profile/settings" className="mdot-profile-link">
          <span>⚙️</span>
          <span>Settings</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}
