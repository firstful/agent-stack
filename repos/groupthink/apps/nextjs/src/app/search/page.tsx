"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { SkeletonFeed } from "@/components/SkeletonFeed";

type SearchScope = "global" | "my-groups";

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="search-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") || "";
  const scopeParam = (searchParams.get("scope") || "global") as SearchScope;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(q);
  const [results, setResults] = useState<{ groups: any[]; messages: any[] }>({
    groups: [],
    messages: [],
  });
  const [scope, setScope] = useState<SearchScope>(scopeParam);
  const [loading, setLoading] = useState(false);

  // Perform search when query or scope changes
  useEffect(() => {
    if (!query) {
      setResults({ groups: [], messages: [] });
      return;
    }

    setLoading(true);
    const fetcher = scope === "my-groups" ? api.searchGroups : api.search;
    fetcher(query)
      .then(setResults)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [query, scope]);

  // Sync from URL on mount and navigation
  useEffect(() => {
    setQuery(q);
    setScope(scopeParam);
  }, [q, scopeParam]);

  // Update URL when scope changes
  const handleScopeChange = useCallback(
    (newScope: SearchScope) => {
      setScope(newScope);
      const params = new URLSearchParams(searchParams.toString());
      params.set("scope", newScope);
      if (query) params.set("q", query);
      router.replace(`/search?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, query],
  );

  // Cmd+K: focus search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Navigate on Enter
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      const params = new URLSearchParams();
      params.set("q", trimmed);
      params.set("scope", scope);
      router.push(`/search?${params.toString()}`);
    }
  };

  return (
    <>
      {/* ── Search bar ── */}
      <form onSubmit={handleSubmit} className="search-bar-form">
        <div className="search-bar-wrapper">
          <span className="search-bar-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="search-bar-input"
            placeholder="Search groups, messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <span className="search-bar-shortcut">
            <kbd>⌘K</kbd>
          </span>
        </div>
      </form>

      {/* ── Scope toggle ── */}
      <div className="search-scope-toggle">
        <button
          className={`search-scope-btn ${scope === "global" ? "active" : ""}`}
          onClick={() => handleScopeChange("global")}
        >
          All Groups
        </button>
        <button
          className={`search-scope-btn ${scope === "my-groups" ? "active" : ""}`}
          onClick={() => handleScopeChange("my-groups")}
        >
          My Groups
        </button>
      </div>

      {!query && (
        <p className="empty search-hint">
          Type above to search groups and messages
        </p>
      )}

      {loading && (
        <div className="search-loading">
          <div className="skeleton skeleton-line skeleton-line--full" />
          <div className="skeleton skeleton-line skeleton-line--half" />
          <div className="skeleton skeleton-line skeleton-line--full" />
        </div>
      )}

      {!loading && query && (
        <>
          <section className="search-section">
            <h2>
              Groups
              {results.groups.length > 0 && (
                <span className="search-count">({results.groups.length})</span>
              )}
            </h2>
            {results.groups.map((g: any) => (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="search-result-group"
              >
                <strong>{highlightText(g.name, query)}</strong>
                {g.bio && <p>{highlightText(g.bio, query)}</p>}
              </Link>
            ))}
            {results.groups.length === 0 && (
              <p className="empty">No groups found</p>
            )}
          </section>

          <section className="search-section">
            <h2>
              Messages
              {results.messages.length > 0 && (
                <span className="search-count">
                  ({results.messages.length})
                </span>
              )}
            </h2>
            {results.messages.map((m: any) => (
              <div key={m.id} className="search-result-message">
                {m.group && (
                  <span className="search-result-group-label">
                    {m.group.name}:
                  </span>
                )}{" "}
                {highlightText(m.content?.slice(0, 300), query)}
              </div>
            ))}
            {results.messages.length === 0 && (
              <p className="empty">No messages found</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <AppShell>
      <div className="search-view">
        <h1>Search</h1>
        <Suspense fallback={<SkeletonFeed />}>
          <SearchResults />
        </Suspense>
      </div>
    </AppShell>
  );
}
