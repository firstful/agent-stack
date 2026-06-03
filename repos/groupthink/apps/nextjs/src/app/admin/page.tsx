"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";

// ── Types ──

type BannedWord = {
  id: string;
  word: string;
  addedBy: string;
  createdAt: string;
  addedByUser: { id: string; username: string };
};

type FraudEntry = {
  id: string;
  action: string;
  userId: string | null;
  groupId: string | null;
  details: Record<string, any> | null;
  createdBy: string | null;
  createdAt: string;
  user_username: string | null;
};

// ── Admin check — simple /api/auth/me as authoritative ──

// ── Component ──

export default function AdminPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"banned-words" | "fraud-log">("banned-words");

  // Banned words
  const [bannedWords, setBannedWords] = useState<BannedWord[]>([]);
  const [bwLoading, setBwLoading] = useState(true);
  const [newWord, setNewWord] = useState("");
  const [bwSaving, setBwSaving] = useState(false);
  const [bwError, setBwError] = useState("");
  const [bwSuccess, setBwSuccess] = useState("");

  // Fraud audit log
  const [fraudEntries, setFraudEntries] = useState<FraudEntry[]>([]);
  const [fraudLoading, setFraudLoading] = useState(true);
  const [fraudCursor, setFraudCursor] = useState<string | null>(null);
  const [fraudHasMore, setFraudHasMore] = useState(false);
  const [fraudFilterAction, setFraudFilterAction] = useState("");
  const [fraudLoadingMore, setFraudLoadingMore] = useState(false);

  // Auth gate
  useEffect(() => {
    const uid = localStorage.getItem("gt-user-id");
    if (!uid) {
      router.push("/login");
      return;
    }
    setUserId(uid);
  }, [router]);

  // ── Banned Words ──

  const loadBannedWords = useCallback(async () => {
    setBwLoading(true);
    try {
      const words = await api.bannedWords();
      setBannedWords(words);
    } catch (err: any) {
      console.error("failed to load banned words", err);
    } finally {
      setBwLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId && activeTab === "banned-words") {
      loadBannedWords();
    }
  }, [userId, activeTab, loadBannedWords]);

  const handleAddBannedWord = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newWord.trim()) return;
      setBwSaving(true);
      setBwError("");
      setBwSuccess("");
      try {
        await api.addBannedWord(newWord.trim());
        setNewWord("");
        setBwSuccess(`"${newWord.trim().toLowerCase()}" added to banned words`);
        await loadBannedWords();
      } catch (err: any) {
        setBwError(err.message);
      } finally {
        setBwSaving(false);
      }
    },
    [newWord, loadBannedWords]
  );

  const handleDeleteBannedWord = useCallback(
    async (id: string, word: string) => {
      if (!confirm(`Remove "${word}" from banned words?`)) return;
      try {
        await api.deleteBannedWord(id);
        setBannedWords((prev) => prev.filter((w) => w.id !== id));
      } catch (err: any) {
        console.error("delete failed", err);
      }
    },
    []
  );

  // ── Fraud Audit Log ──

  const loadFraudLog = useCallback(
    async (cursor?: string, append = false) => {
      const loadingFn = append ? setFraudLoadingMore : setFraudLoading;
      loadingFn(true);
      try {
        const result = await api.fraudAuditLog(
          cursor,
          fraudFilterAction || undefined
        );
        if (append) {
          setFraudEntries((prev) => [...prev, ...result.entries]);
        } else {
          setFraudEntries(result.entries);
        }
        setFraudCursor(result.nextCursor);
        setFraudHasMore(result.nextCursor !== null);
      } catch (err: any) {
        console.error("failed to load fraud log", err);
      } finally {
        loadingFn(false);
      }
    },
    [fraudFilterAction]
  );

  useEffect(() => {
    if (userId && activeTab === "fraud-log") {
      setFraudEntries([]);
      setFraudCursor(null);
      loadFraudLog();
    }
  }, [userId, activeTab, fraudFilterAction, loadFraudLog]);

  const handleLoadMore = useCallback(() => {
    if (fraudCursor && !fraudLoadingMore) {
      loadFraudLog(fraudCursor, true);
    }
  }, [fraudCursor, fraudLoadingMore, loadFraudLog]);

  // ── Render ──

  return (
    <AppShell>
      <div className="admin-view">
        <div className="admin-header">
          <h1>Admin Panel</h1>
        </div>

        {/* Tab navigation */}
        <div className="admin-tabs">
          <button
            className={activeTab === "banned-words" ? "active" : ""}
            onClick={() => setActiveTab("banned-words")}
          >
            Banned Words
          </button>
          <button
            className={activeTab === "fraud-log" ? "active" : ""}
            onClick={() => setActiveTab("fraud-log")}
          >
            Fraud Audit Log
          </button>
        </div>

        {/* ═══════════ BANNED WORDS TAB ═══════════ */}
        {activeTab === "banned-words" && (
          <div className="admin-tab-content">
            {/* Add form */}
            <div className="admin-card">
              <h2>Add Banned Word</h2>
              <p className="settings-description">
                Words added here are blocked from broadcast messages. Entries are
                case-insensitive and trimmed automatically.
              </p>
              <form className="admin-bw-form" onSubmit={handleAddBannedWord}>
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  placeholder="Enter a word or phrase"
                  maxLength={100}
                  required
                />
                <button type="submit" disabled={bwSaving || !newWord.trim()}>
                  {bwSaving ? "Adding..." : "Add"}
                </button>
              </form>
              {bwError && <p className="form-error">{bwError}</p>}
              {bwSuccess && <p className="form-success">{bwSuccess}</p>}
            </div>

            {/* Word list */}
            <div className="admin-card">
              <h2>Banned Words ({bannedWords.length})</h2>
              {bwLoading ? (
                <div className="admin-loading">
                  <div className="skeleton skeleton-line skeleton-line--full" />
                  <div className="skeleton skeleton-line skeleton-line--full" style={{ marginTop: 6 }} />
                  <div className="skeleton skeleton-line skeleton-line--full" style={{ marginTop: 6 }} />
                </div>
              ) : bannedWords.length === 0 ? (
                <p className="empty">No banned words yet.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Word</th>
                      <th>Added By</th>
                      <th>Added At</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bannedWords.map((bw) => (
                      <tr key={bw.id}>
                        <td>
                          <code className="banned-word-text">{bw.word}</code>
                        </td>
                        <td className="admin-cell-muted">
                          {bw.addedByUser?.username ?? "unknown"}
                        </td>
                        <td className="admin-cell-muted">
                          {new Date(bw.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                        <td className="admin-cell-action">
                          <button
                            className="admin-delete-btn"
                            onClick={() => handleDeleteBannedWord(bw.id, bw.word)}
                            title="Remove banned word"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ FRAUD AUDIT LOG TAB ═══════════ */}
        {activeTab === "fraud-log" && (
          <div className="admin-tab-content">
            <div className="admin-card">
              <div className="fraud-controls">
                <h2>Audit Log</h2>
                <select
                  value={fraudFilterAction}
                  onChange={(e) => setFraudFilterAction(e.target.value)}
                  className="fraud-filter-select"
                >
                  <option value="">All actions</option>
                  <option value="shadow_ban">Shadow Ban</option>
                  <option value="lift_shadow_ban">Lift Shadow Ban</option>
                  <option value="flag_user">Flag User</option>
                  <option value="message_report">Message Report</option>
                  <option value="review_report">Review Report</option>
                  <option value="cohort_flag">Cohort Flag</option>
                </select>
              </div>

              {fraudLoading ? (
                <div className="admin-loading">
                  <div className="skeleton skeleton-line skeleton-line--full" />
                  <div className="skeleton skeleton-line skeleton-line--full" style={{ marginTop: 6 }} />
                  <div className="skeleton skeleton-line skeleton-line--full" style={{ marginTop: 6 }} />
                </div>
              ) : fraudEntries.length === 0 ? (
                <p className="empty">No audit log entries found.</p>
              ) : (
                <>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>User</th>
                        <th>Group ID</th>
                        <th>Details</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fraudEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <span className="fraud-action-badge">
                              {entry.action.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="admin-cell-muted">
                            {entry.user_username ?? entry.userId?.slice(0, 8) ?? "—"}
                          </td>
                          <td className="admin-cell-muted">
                            {entry.groupId ? (
                              <code className="fraud-id">{entry.groupId.slice(0, 8)}…</code>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {entry.details ? (
                              <details className="fraud-details">
                                <summary className="fraud-details-summary">View</summary>
                                <pre className="fraud-details-pre">
                                  {JSON.stringify(entry.details, null, 2)}
                                </pre>
                              </details>
                            ) : (
                              <span className="admin-cell-muted">—</span>
                            )}
                          </td>
                          <td className="admin-cell-muted">
                            {new Date(entry.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {fraudHasMore && (
                    <div className="admin-load-more">
                      <button
                        onClick={handleLoadMore}
                        disabled={fraudLoadingMore}
                      >
                        {fraudLoadingMore ? "Loading..." : "Load More"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
