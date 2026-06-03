"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type GroupResult = { id: string; name: string; bio: string; energy: string };
type MessageResult = { id: string; content: string; group: { id: string; name: string } };
type Results = { groups: GroupResult[]; messages: MessageResult[] };

export default function MobileSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      fetch(`${API}/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const hasGroups = results && results.groups.length > 0;
  const hasMessages = results && results.messages.length > 0;

  return (
    <div className="mdot-search">
      <div className="mdot-search-bar-wrap">
        <input
          className="mdot-search-input"
          type="search"
          placeholder="Search groups and messages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      {!query.trim() && (
        <div className="mdot-search-empty">
          <p>Find groups by name or browse public messages</p>
        </div>
      )}

      {query.trim() && !loading && !hasGroups && !hasMessages && (
        <div className="mdot-search-empty">
          <p>No results for &ldquo;{query}&rdquo;</p>
        </div>
      )}

      <div className="mdot-search-results">
        {hasGroups && (
          <div className="mdot-search-section">
            <h2>Groups ({results!.groups.length})</h2>
            {results!.groups.map((g) => (
              <Link key={g.id} href={`/m/groups/${g.id}`} className="mdot-search-result">
                <strong>{g.name}</strong>
                {g.bio && <p>{g.bio}</p>}
              </Link>
            ))}
          </div>
        )}

        {hasMessages && (
          <div className="mdot-search-section">
            <h2>Messages ({results!.messages.length})</h2>
            {results!.messages.map((m) => (
              <div key={m.id} className="mdot-search-result">
                <strong>{m.group?.name ?? "unknown"}</strong>
                <p>{m.content.slice(0, 200)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
