"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

function SearchResults() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const [results, setResults] = useState<{ groups: any[]; messages: any[] }>({
    groups: [],
    messages: [],
  });

  useEffect(() => {
    if (q) api.search(q).then(setResults);
  }, [q]);

  return (
    <>
      <h1>Search: {q}</h1>

      <section className="search-section">
        <h2>Groups</h2>
        {results.groups.map((g: any) => (
          <Link key={g.id} href={`/groups/${g.id}`} className="search-result-group">
            <strong>{g.name}</strong>
            <p>{g.bio}</p>
          </Link>
        ))}
        {results.groups.length === 0 && <p className="empty">No groups found</p>}
      </section>

      <section className="search-section">
        <h2>Messages</h2>
        {results.messages.map((m: any) => (
          <div key={m.id} className="search-result-message">
            <strong>{m.group?.name}:</strong> {m.content?.slice(0, 200)}
          </div>
        ))}
        {results.messages.length === 0 && <p className="empty">No messages found</p>}
      </section>
    </>
  );
}

export default function SearchPage() {
  return (
    <div className="search-view">
      <Suspense fallback={<div className="feed-view">Loading...</div>}>
        <SearchResults />
      </Suspense>
    </div>
  );
}
