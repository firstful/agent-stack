"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SkeletonFeed } from "@/components/SkeletonFeed";
import { EnergyBadge } from "@/components/EnergyBadge";
import { ThreadIndicator } from "@/components/ThreadIndicator";
import { ReplyModal } from "@/components/ReplyModal";
import { useFeedKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";

type Group = {
  id: string;
  name: string;
  bio: string;
  energy: string;
};

type ParentPost = {
  id: string;
  content: string;
  group: { id: string; name: string };
};

type Message = {
  id: string;
  content: string;
  status: "active" | "revoked";
  createdAt: string;
  group: Group;
  targetGroup?: { id: string; name: string; energy?: string };
  targetPostId?: string;
  revokedAt?: string;
  endorsements: number;
  nickname: string | null;
  parentPost: ParentPost | null;
};

export default function FeedPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [minTier, setMinTier] = useState("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [shortcutHint, setShortcutHint] = useState("");

  // Reply modal state
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);

  // Sentinel ref for IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Feed fetching ──

  const fetchFeed = useCallback(
    async (tier: string, sortBy: string, pageCursor?: string | null) => {
      if (!pageCursor) {
        setLoading(true);
        setMessages([]);
        setCursor(null);
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await api.feed(tier || undefined, sortBy, pageCursor || undefined);
        const incoming = (res.messages ?? []) as Message[];

        if (!pageCursor) {
          setMessages(incoming);
        } else {
          setMessages((prev) => [...prev, ...incoming]);
        }

        setCursor(res.nextCursor);
        setHasMore(res.nextCursor !== null && incoming.length > 0);
      } catch (e) {
        console.error("feed error", e);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // Initial load and refetch when filter/sort changes
  useEffect(() => {
    fetchFeed(minTier, sort, null);
  }, [minTier, sort, fetchFeed]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && cursor) {
          fetchFeed(minTier, sort, cursor);
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, cursor, minTier, sort, fetchFeed]);

  const tiers = ["", "small", "medium", "large", "huge", "massive"];

  // Active message actions
  const activeMessage = activeIndex >= 0 ? messages[activeIndex] : null;

  // ── Optimistic endorse ──
  const handleEndorse = useCallback(
    (targetId?: string) => {
      const id = targetId ?? activeMessage?.id;
      if (!id) {
        setShortcutHint("Focus a post first with j/k");
        setTimeout(() => setShortcutHint(""), 2000);
        return;
      }

      // Optimistic increment
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.status === "active"
            ? { ...m, endorsements: m.endorsements + 1 }
            : m
        )
      );

      api
        .endorseMessage(id)
        .then((res) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, endorsements: res.endorsements } : m
            )
          );
          setShortcutHint(`Endorsed! (${res.endorsements})`);
          setTimeout(() => setShortcutHint(""), 2000);
        })
        .catch((err) => {
          // Rollback: refetch the message's actual count
          setShortcutHint(`Endorse failed: ${err.message}`);
          setTimeout(() => setShortcutHint(""), 3000);
          api.feed(minTier || undefined, sort, null).then((res) => {
            const updated = res.messages as Message[];
            setMessages((prev) =>
              prev.map(
                (m) => updated.find((u) => u.id === m.id) ?? m
              )
            );
          }).catch(() => {});
        });
    },
    [activeMessage, minTier, sort]
  );

  const handleReply = useCallback(
    (targetId?: string) => {
      const id = targetId ?? activeMessage?.id;
      if (!id) {
        setShortcutHint("Focus a post first with j/k");
        setTimeout(() => setShortcutHint(""), 2000);
        return;
      }
      const msg =
        messages.find((m) => m.id === id) ?? activeMessage;
      if (msg) setReplyTarget(msg);
    },
    [activeMessage, messages]
  );

  const handleSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(".search-form input");
    input?.focus();
  }, []);

  const handleViewPost = useCallback(() => {
    if (!activeMessage) {
      setShortcutHint("Focus a post first with j/k");
      setTimeout(() => setShortcutHint(""), 2000);
      return;
    }
    window.location.href = `/groups/${activeMessage.group.id}#msg-${activeMessage.id}`;
  }, [activeMessage]);

  const { showHelp, toggleHelp } = useFeedKeyboardShortcuts({
    onEndorse: () => handleEndorse(),
    onReply: () => handleReply(),
    onViewPost: handleViewPost,
    onNewest: () => setSort("newest"),
    onPopular: () => setSort("popular"),
    onSearch: handleSearch,
    activeIndex,
    setActiveIndex,
    maxIndex: messages.length,
    enabled: !loading,
  });

  const SHORTCUTS = [
    { key: "j / ↓", label: "Move down" },
    { key: "k / ↑", label: "Move up" },
    { key: "e", label: "Endorse" },
    { key: "r", label: "Reply" },
    { key: "v", label: "View post" },
    { key: "1", label: "Sort: newest" },
    { key: "2", label: "Sort: popular" },
    { key: "/", label: "Search" },
    { key: "?", label: "Toggle help" },
  ];

  return (
    <AppShell>
    <div className="feed-view">
      <header className="feed-header">
        <div className="feed-header-left">
          <h1>Feed</h1>
          {shortcutHint && <span className="shortcut-hint">{shortcutHint}</span>}
        </div>
        <div className="feed-controls">
          <button
            className={`sort-btn ${sort === "newest" ? "active" : ""}`}
            onClick={() => setSort("newest")}
            title="Sort by newest (1)"
          >
            Newest
          </button>
          <button
            className={`sort-btn ${sort === "popular" ? "active" : ""}`}
            onClick={() => setSort("popular")}
            title="Sort by popular (2)"
          >
            Popular
          </button>
          <select value={minTier} onChange={(e) => setMinTier(e.target.value)}>
            <option value="">all tiers</option>
            {tiers.filter(Boolean).map((t) => (
              <option key={t} value={t}>{t}+</option>
            ))}
          </select>
        </div>
      </header>

      {/* Keyboard shortcut help bar */}
      <div className="shortcuts-bar">
        <span><kbd>j</kbd>/<kbd>k</kbd> navigate</span>
        <span><kbd>e</kbd> endorse</span>
        <span><kbd>r</kbd> reply</span>
        <span><kbd>v</kbd> view</span>
        <span><kbd>1</kbd>/<kbd>2</kbd> sort</span>
        <span><kbd>/</kbd> search</span>
        <button className="shortcuts-help-btn" onClick={toggleHelp} title="Keyboard shortcuts (?)">
          <kbd>?</kbd>
        </button>
      </div>

      {loading ? (
        <ErrorBoundary
          fallback={
            <div className="feed-loading">Loading feed…</div>
          }
        >
          <SkeletonFeed />
        </ErrorBoundary>
      ) : messages.length === 0 ? (
        <div className="feed-empty">No posts in your feed yet.</div>
      ) : (
        <div className="message-list">
          {messages.map((msg, i) => (
            <article
              key={msg.id}
              className={`message-card ${msg.status === "revoked" ? "revoked" : ""} ${i === activeIndex ? "message-card--active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              id={`msg-${msg.id}`}
            >
              {/* Thread indicator (parent post reference) */}
              {msg.parentPost && <ThreadIndicator parentPost={msg.parentPost} />}

              <div className="message-header">
                <Link href={`/groups/${msg.group.id}`} className="group-name">
                  {msg.group.name}
                </Link>

                {/* Energy badge */}
                <EnergyBadge energy={msg.group.energy} animate={i === 0} />

                {msg.group.bio && (
                  <span className="group-bio">{msg.group.bio}</span>
                )}

                {msg.targetGroup && (
                  <span className="target-group">
                    →{" "}
                    {msg.nickname ? (
                      <span className="nickname" title={`Real: ${msg.targetGroup.name}`}>
                        {msg.nickname}
                      </span>
                    ) : (
                      msg.targetGroup.name
                    )}
                  </span>
                )}

                <time className="timestamp">
                  {new Date(msg.createdAt).toLocaleString()}
                </time>
              </div>

              <p className="message-content">{msg.content}</p>

              {msg.status === "revoked" && (
                <div className="revoked-banner">
                  <span className="revoked-banner-icon">⚠️</span>
                  <span className="revoked-banner-text">
                    This message was revoked
                    {msg.revokedAt && (
                      <> on {new Date(msg.revokedAt).toLocaleString()}</>
                    )}
                  </span>
                </div>
              )}

              <div className="message-actions">
                <button
                  className="reply-btn"
                  onClick={() => handleReply(msg.id)}
                >
                  Reply
                </button>
                <button
                  className="endorse-btn"
                  onClick={() => handleEndorse(msg.id)}
                >
                  Endorse
                </button>
                <span className="endorse-count">
                  {msg.endorsements} {msg.endorsements === 1 ? "endorsement" : "endorsements"}
                </span>
              </div>
            </article>
          ))}

          {/* Infinite scroll sentinel & loading indicator */}
          {hasMore && (
            <div ref={sentinelRef} className="scroll-sentinel">
              {loadingMore && (
                <div className="feed-loading-more">Loading more posts…</div>
              )}
            </div>
          )}

          {!hasMore && messages.length > 0 && (
            <div className="feed-end">You&apos;ve reached the end of the feed.</div>
          )}
        </div>
      )}

      {/* Keyboard shortcut help overlay */}
      {showHelp && (
        <div className="shortcut-overlay" onClick={toggleHelp}>
          <div className="shortcut-overlay-content" onClick={(e) => e.stopPropagation()}>
            <div className="shortcut-overlay-header">
              <h2>Keyboard Shortcuts</h2>
              <button className="shortcut-close-btn" onClick={toggleHelp}>
                ✕
              </button>
            </div>
            <div className="shortcut-overlay-list">
              {SHORTCUTS.map(({ key, label }) => (
                <div key={key} className="shortcut-row">
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className="shortcut-overlay-footer">
              Press <kbd>?</kbd> or click outside to close
            </p>
          </div>
        </div>
      )}

      {/* Reply Modal */}
      {replyTarget && (
        <ReplyModal
          targetPost={replyTarget}
          onClose={() => setReplyTarget(null)}
          onCreated={() => {
            setReplyTarget(null);
            // Refresh feed to show the new impulse-linked post
            fetchFeed(minTier, sort, null);
          }}
        />
      )}
    </div>
    </AppShell>
  );
}
