"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString();
}

function notifEmoji(type: string): string {
  switch (type) {
    case "message": return "💬";
    case "impulse": return "💡";
    case "vote": return "✅";
    case "member": return "👤";
    case "endorsement": return "❤️";
    case "kick": return "⚠️";
    case "split": return "🔀";
    case "merge": return "🔗";
    case "sabbatical": return "🌙";
    case "system": return "ℹ️";
    default: return "🔔";
  }
}

export default function MobileNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async (reset = false) => {
    setLoading(reset);
    const params = new URLSearchParams({ limit: "20" });
    if (!reset && cursor) params.set("cursor", cursor);

    try {
      const r = await fetch(`${API}/api/notifications?${params}`);
      const data = await r.json();
      if (reset) {
        setNotifications(data.notifications ?? []);
      } else {
        setNotifications((prev) => [...prev, ...(data.notifications ?? [])]);
      }
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/notifications/unread-count`);
      if (r.ok) {
        const data = await r.json();
        setUnreadCount(data.count ?? 0);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchNotifications(true);
    fetchUnreadCount();
  }, []);

  const handleMarkRead = async (id: string) => {
    try {
      await fetch(`${API}/api/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silently fail
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch(`${API}/api/notifications/read-all`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch {
      // Silently fail
    }
  };

  const handleLoadMore = () => {
    if (hasMore && !loadingMore) {
      setLoadingMore(true);
      fetchNotifications(false);
    }
  };

  const unreadItems = notifications.filter((n) => !n.readAt);

  return (
    <div className="mdot-feed">
      {/* Header */}
      <div className="mdot-notif-header">
        <h1>Notifications</h1>
        {unreadCount > 0 && (
          <button className="mdot-notif-mark-all" onClick={handleMarkAllRead}>
            Mark all read
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="feed-loading" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          Loading notifications…
        </div>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <div className="mdot-notif-empty">
          <div className="mdot-notif-empty-icon">🔔</div>
          <h3>No notifications yet</h3>
          <p>When someone messages your group or an impulse reaches a milestone, you'll see it here</p>
        </div>
      )}

      {/* Notification list */}
      {!loading && notifications.length > 0 && (
        <div className="mdot-notif-list">
          {notifications.map((n) => {
            const isUnread = !n.readAt;
            return (
              <div
                key={n.id}
                className={`mdot-notif-item ${isUnread ? "unread" : ""}`}
                onClick={() => isUnread && handleMarkRead(n.id)}
              >
                <span className="mdot-notif-icon">{notifEmoji(n.type)}</span>
                <div className="mdot-notif-body">
                  <p style={{ fontWeight: isUnread ? 600 : 400 }}>{n.title}</p>
                  {n.body && <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{n.body}</p>}
                  <span className="mdot-notif-time">{timeAgo(n.createdAt)}</span>
                </div>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign: "center", padding: 16 }}>
              <button className="btn btn-sm" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {!hasMore && notifications.length > 0 && (
            <div style={{ textAlign: "center", padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              All caught up
            </div>
          )}
        </div>
      )}
    </div>
  );
}
