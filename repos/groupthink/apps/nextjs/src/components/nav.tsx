"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Group = { id: string; name: string; bio: string };

export function Nav() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState("");
  const { state, logout } = useAuth();

  const isAuthenticated = state.status === "authenticated";

  useEffect(() => {
    api.groups().then(setGroups).catch(() => {});
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(search)}`;
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
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

      {isAuthenticated && (
        <div className="nav-actions">
          <Link href="/groups/new" className="nav-btn">+ New Group</Link>
          <Link href="/join" className="nav-btn">Join Group</Link>
        </div>
      )}

      {isAuthenticated && (
        <div className="nav-footer-links">
          <Link href="/settings" className="nav-footer-link">⚙ Settings</Link>
          <Link href="/admin" className="nav-footer-link">🛡 Admin</Link>
          <button onClick={handleLogout} className="nav-footer-link nav-footer-btn">
            Sign out
          </button>
        </div>
      )}

      <div className="groups-list">
        <h3>My Groups</h3>
        {groups.map((g) => (
          <Link key={g.id} href={`/groups/${g.id}`} className="group-link">
            {g.name}
          </Link>
        ))}
        {!isAuthenticated && (
          <p className="login-hint">
            <Link href="/login">Sign in</Link> to see your groups
          </p>
        )}
      </div>
    </nav>
  );
}
