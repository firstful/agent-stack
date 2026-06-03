"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Message = {
  id: string;
  content: string;
  createdAt: string;
  group: { id: string; name: string; bio: string; energy: string };
  endorsements: number;
  status: string;
};

export default function MobileFeedPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tier) params.set("minTier", tier);
    fetch(`${API}/api/feed?${params}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tier]);

  return (
    <div className="mdot-feed">
      <div className="mdot-feed-header">
        <h1>Feed</h1>
        <div className="mdot-feed-controls">
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">all tiers</option>
            <option value="small">small+</option>
            <option value="medium">medium+</option>
            <option value="large">large+</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="feed-loading">Loading feed…</div>
      ) : messages.length === 0 ? (
        <div className="feed-empty">No posts yet.</div>
      ) : (
        <div className="message-list">
          {messages.map((msg) => (
            <article key={msg.id} className="message-card">
              <div className="message-header">
                <Link href={`/m/groups/${msg.group.id}`} className="group-name">
                  {msg.group.name}
                </Link>
                <time className="timestamp">
                  {new Date(msg.createdAt).toLocaleDateString()}
                </time>
              </div>
              <p className="message-content">{msg.content}</p>
              {msg.endorsements > 0 && (
                <span className="endorse-count">
                  {msg.endorsements} endorsement{msg.endorsements !== 1 ? "s" : ""}
                </span>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
