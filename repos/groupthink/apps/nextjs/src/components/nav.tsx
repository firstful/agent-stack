"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Group = { id: string; name: string; bio: string };

export function Nav() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(localStorage.getItem("gt-user-id"));
    api.groups().then(setGroups).catch(() => {});
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(search)}`;
    }
  };

  return (
    <nav className="nav-panel">
      <div className="nav-header">
        <Link href="/" className="logo">Groupthink</Link>
      </div>

      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          placeholder="Search groups, posts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      {userId && (
        <div className="nav-actions">
          <Link href="/groups/new" className="nav-btn">+ New Group</Link>
          <Link href="/join" className="nav-btn">Join Group</Link>
        </div>
      )}

      <div className="groups-list">
        <h3>My Groups</h3>
        {groups.map((g) => (
          <Link key={g.id} href={`/groups/${g.id}`} className="group-link">
            {g.name}
          </Link>
        ))}
        {!userId && (
          <p className="login-hint">
            <Link href="/login">Sign in</Link> to see your groups
          </p>
        )}
      </div>
    </nav>
  );
}
