"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Link from "next/link";

type Message = {
  id: string;
  content: string;
  status: "active" | "revoked";
  createdAt: string;
  group: { id: string; name: string; bio: string };
  targetGroup?: { id: string; name: string };
  revokedAt?: string;
};

export default function FeedPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [minTier, setMinTier] = useState("");

  useEffect(() => {
    api.feed(minTier || undefined).then(setMessages);
  }, [minTier]);

  const tiers = ["", "small", "medium", "large", "huge", "massive"];

  return (
    <div className="feed-view">
      <header className="feed-header">
        <h1>Feed</h1>
        <div className="feed-controls">
          <select value={minTier} onChange={(e) => setMinTier(e.target.value)}>
            <option value="">all tiers</option>
            {tiers.filter(Boolean).map((t) => (
              <option key={t} value={t}>{t}+</option>
            ))}
          </select>
        </div>
      </header>

      <div className="message-list">
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={`message-card ${msg.status === "revoked" ? "revoked" : ""}`}
          >
            <div className="message-header">
              <Link href={`/groups/${msg.group.id}`} className="group-name">
                {msg.group.name}
              </Link>
              {msg.group.bio && (
                <span className="group-bio">{msg.group.bio}</span>
              )}
              {msg.targetGroup && (
                <span className="target-group">
                  → {msg.targetGroup.name}
                </span>
              )}
              <time className="timestamp">
                {new Date(msg.createdAt).toLocaleString()}
              </time>
            </div>

            <p className="message-content">{msg.content}</p>

            {msg.status === "revoked" && (
              <div className="revoked-banner">
                Revoked {msg.revokedAt && new Date(msg.revokedAt).toLocaleString()}
              </div>
            )}

            <div className="message-actions">
              <Link href={`/impulses/new?replyTo=${msg.id}`} className="reply-btn">
                Reply
              </Link>
              <button className="retweet-btn">Endorse</button>
              <span className="retweet-count">0 endorsements</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
