"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SkeletonNav } from "@/components/SkeletonNav";

type Group = { id: string; name: string; bio: string };

export function Nav() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const { state, logout } = useAuth();
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isAuthenticated = state.status === "authenticated";
  const userId = state.status === "authenticated" ? state.user.id : null;

  useEffect(() => {
    setLoadingGroups(true);
    api
      .groups()
      .then((gs) => {
        setGroups(gs);
      })
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
  }, []);

  if (loadingGroups) {
    return <SkeletonNav />;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}&scope=global`);
    }
  };

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  // Cmd+K: focus search input, / when not in an input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <nav className="nav-panel">
      <div className="nav-header">
        <Link href="/" className="logo">Groupthink</Link>
      </div>

      <form onSubmit={handleSearch} className="search-form">
        <div className="search-form-wrapper">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search groups, posts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="search-form-shortcut">
            <kbd>⌘K</kbd>
          </span>
        </div>
      </form>

      {isAuthenticated && (
        <div className="nav-actions">
          <Link href="/groups/new" className="nav-btn">+ New Group</Link>
          <Link href="/join" className="nav-btn">Join Group</Link>
        </div>
      )}

      {isAuthenticated && (
        <div className="nav-footer-links">
          <Link href={`/users/${userId}`} className="nav-footer-link">👤 Profile</Link>
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
