"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Group = { id: string; name: string; bio: string; energy: string };

export default function MobileGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/groups`)
      .then((r) => r.json())
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mdot-groups">
      <div className="mdot-groups-header">
        <h1>Groups</h1>
      </div>

      {loading ? (
        <div className="feed-loading" style={{ padding: 24, textAlign: "center" }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div className="feed-empty" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          <p>No groups yet</p>
        </div>
      ) : (
        <div className="mdot-groups-list">
          {groups.map((g) => (
            <Link key={g.id} href={`/m/groups/${g.id}`} className="mdot-group-card">
              <div className="mdot-group-card-info">
                <div className="mdot-group-card-name">{g.name}</div>
                {g.bio && <div className="mdot-group-card-bio">{g.bio}</div>}
              </div>
              <span className="mdot-group-card-tier">{g.energy}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
