"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";

// ── Types ──

type Vote = {
  id: string;
  vote: string;
  weight: number;
  userId: string;
};

type User = {
  id: string;
  username: string;
};

type Draft = {
  id: string;
  content: string;
  userId: string;
  parentDraftId?: string | null;
  createdAt: string;
  user: User;
};

type SummaryCandidate = {
  id: string;
  impulseId: string;
  content: string;
  votes: number;
  createdAt: string;
};

type Impulse = {
  id: string;
  title: string;
  description: string;
  status: string;
  groupId: string;
  targetGroupId?: string | null;
  createdAt: string;
  votingEndsAt?: string | null;
  votes?: Vote[];
  drafts?: Draft[];
  summaryCandidates?: SummaryCandidate[];
};

// ── Props ──

type ComposerModalProps = {
  impulse: Impulse;
  groupName: string;
  currentUserId: string;
  onClose: () => void;
  onTransition: () => void; // called when impulse transitions to new phase
};

// ── Timer helpers ──

const MAX_COMPOSING_WINDOW = 3600000; // 1 hour
const DRAFT_EXTEND_FACTOR = 0.2;

function composingRemaining(draftCount: number, elapsedMs: number): number {
  const extension = draftCount * MAX_COMPOSING_WINDOW * DRAFT_EXTEND_FACTOR;
  const remaining = MAX_COMPOSING_WINDOW + extension - elapsedMs;
  if (remaining <= 0) return 0;
  return Math.max(remaining, 300000); // min 5 minutes
}

function formatTime(ms: number): string {
  if (ms <= 0) return "Ending now";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ── Draft tree builder ──

type DraftNode = Draft & { children: DraftNode[]; depth: number };

function buildDraftTree(drafts: Draft[]): DraftNode[] {
  const map = new Map<string, DraftNode>();
  const roots: DraftNode[] = [];

  for (const d of drafts) {
    map.set(d.id, { ...d, children: [], depth: 0 });
  }

  for (const d of drafts) {
    const node = map.get(d.id)!;
    if (d.parentDraftId && map.has(d.parentDraftId)) {
      const parent = map.get(d.parentDraftId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children chronologically
  const sort = (nodes: DraftNode[]) => {
    nodes.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const n of nodes) sort(n.children);
  };
  sort(roots);

  return roots;
}

// ── Component ──

const POLL_INTERVAL = 3000;

export function ComposerModal({
  impulse: initialImpulse,
  groupName,
  currentUserId,
  onClose,
  onTransition,
}: ComposerModalProps) {
  const [impulse, setImpulse] = useState<Impulse>(initialImpulse);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [summaries, setSummaries] = useState<SummaryCandidate[]>([]);
  const [draftText, setDraftText] = useState("");
  const [selectedSummary, setSelectedSummary] = useState<string | null>(null);
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);
  const [broadcastAnim, setBroadcastAnim] = useState(false);
  const [timerData, setTimerData] = useState({ remaining: MAX_COMPOSING_WINDOW, locked: false });
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [animPhase, setAnimPhase] = useState<string>("idle"); // idle | locking | locked

  const draftsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load data ──
  const load = useCallback(() => {
    api.impulse(impulse.id).then((data: Impulse) => {
      const prevStatus = impulse.status;
      setImpulse(data);
      if (data.status !== prevStatus && prevStatus !== "") {
        onTransition();
      }
    });

    api.drafts(impulse.id).then(setDrafts);
    api.summaries(impulse.id).then(setSummaries);
  }, [impulse.id, onTransition]);

  // Initial load
  useEffect(() => { load(); }, []);

  // Poll during active phases
  useEffect(() => {
    const activePhases = ["composing", "summarizing", "approval"];
    if (!activePhases.includes(impulse.status)) return;

    pollRef.current = setInterval(load, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [impulse.status, load]);

  // ── Adaptive timer for composing phase ──
  useEffect(() => {
    if (impulse.status !== "composing") return;

    const startedAt = new Date(impulse.createdAt).getTime();
    const draftCount = drafts.length;

    const updateTimer = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = composingRemaining(draftCount, elapsed);
      setTimerData({ remaining, locked: remaining <= 0 });

      if (remaining <= 0) {
        setAnimPhase("locking");
        // Brief animation then check status
        setTimeout(() => {
          setAnimPhase("locked");
          load(); // refresh — should now be summarizing
        }, 1200);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [impulse.status, impulse.createdAt, drafts.length, load]);

  // ── Detect broadcast transition ──
  useEffect(() => {
    if (impulse.status === "broadcast" && summaries.length > 0 && !broadcastMsg) {
      setBroadcastMsg(summaries[0].content);
      setBroadcastAnim(true);
      setTimeout(() => setBroadcastAnim(false), 3000);
    }
  }, [impulse.status, summaries, broadcastMsg]);

  // ── Auto-scroll drafts ──
  useEffect(() => {
    if (draftsEndRef.current) {
      draftsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [drafts.length]);

  // ── Handlers ──
  const handleSendDraft = async () => {
    if (!draftText.trim()) return;
    try {
      await api.sendDraft({ impulseId: impulse.id, content: draftText });
      setDraftText("");
      load();
    } catch {
      // Silently fail — will be corrected on next poll
    }
  };

  const handleSendDraftAsReply = async (parentDraftId: string) => {
    if (!draftText.trim()) return;
    try {
      await api.sendDraft({ impulseId: impulse.id, content: draftText, parentDraftId } as any);
      setDraftText("");
      load();
    } catch {
      // Silently fail
    }
  };

  const handleVoteSummary = async (summaryId: string) => {
    setSelectedSummary(summaryId);
    try {
      await api.vote({ impulseId: impulse.id, vote: "yes" });
    } catch {
      // Vote will be recorded on next attempt
    }
  };

  const handleVoteDiscard = async () => {
    setSelectedSummary("discard");
    try {
      await api.vote({ impulseId: impulse.id, vote: "no" });
    } catch {
      // Vote will be recorded on next attempt
    }
  };

  const handleClose = () => {
    if (impulse.status === "composing") {
      setShowCloseWarning(true);
      return;
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSendDraft();
    }
    if (e.key === "Escape" && !showCloseWarning) {
      handleClose();
    }
  };

  // ── Timer urgency ──
  const timerPct = timerData.remaining / MAX_COMPOSING_WINDOW;
  const timerUrgency =
    timerPct > 0.5 ? "normal" :
    timerPct > 0.2 ? "warning" : "critical";

  // ── Draft tree ──
  const draftTree = buildDraftTree(drafts);

  // ── Render draft node recursively ──
  const renderDraftNode = (node: DraftNode) => (
    <div
      key={node.id}
      className={`draft-card depth-${node.depth}`}
      style={{ marginLeft: node.depth * 20 }}
    >
      <div className="draft-card-header">
        <span className="draft-author">{node.user.username}</span>
        <span className="draft-time">{new Date(node.createdAt).toLocaleTimeString()}</span>
        {currentUserId === node.userId && (
          <span className="draft-own-tag">you</span>
        )}
      </div>
      <div className="draft-content">{node.content}</div>
      {node.children.length > 0 && (
        <div className="draft-replies">
          {node.children.map(renderDraftNode)}
        </div>
      )}
    </div>
  );

  // ── Render ──

  if (!impulse) return null;

  const isComposing = impulse.status === "composing";
  const isSummarizing = impulse.status === "summarizing";
  const isApproval = impulse.status === "approval";
  const isBroadcast = impulse.status === "broadcast";
  const isTerminal = ["broadcast", "discarded", "expired"].includes(impulse.status);

  return (
    <div className="composer-modal-overlay" onClick={handleClose}>
      {/* ── Backdrop ── */}
      <div className="composer-modal-backdrop" />

      {/* ── Modal ── */}
      <div
        className={`composer-modal ${isBroadcast ? "broadcast-mode" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* ── Header ── */}
        <div className="composer-modal-header">
          <div className="composer-modal-header-left">
            <button className="composer-modal-close-btn" onClick={handleClose} aria-label="Close">
              ✕
            </button>
            <div className="composer-modal-header-info">
              <h2 className="composer-modal-title">{impulse.title}</h2>
              <span className="composer-modal-group">{groupName}</span>
            </div>
          </div>
          <div className="composer-modal-header-right">
            {isComposing && (
              <span className={`composer-status-badge status-composing ${timerUrgency}`}>
                ✏️ Drafting
              </span>
            )}
            {isSummarizing && (
              <span className="composer-status-badge status-summarizing">
                🤖 Summarizing
              </span>
            )}
            {isApproval && (
              <span className="composer-status-badge status-approval">
                🗳️ Approval
              </span>
            )}
            {isBroadcast && (
              <span className="composer-status-badge status-broadcast">
                📢 Broadcast
              </span>
            )}
            {impulse.status === "discarded" && (
              <span className="composer-status-badge status-discarded">
                — Discarded
              </span>
            )}
            {impulse.status === "expired" && (
              <span className="composer-status-badge status-expired">
                ⏰ Expired
              </span>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="composer-modal-body">
          {impulse.description && (
            <p className="composer-desc">{impulse.description}</p>
          )}

          {/* ── COMPOSING PHASE ── */}
          {isComposing && (
            <div className="composer-phase composing-phase">
              {/* Timer */}
              <div className={`composer-timer timer-${timerUrgency} ${animPhase === "locking" ? "timer-locking" : ""}`}>
                <div className="composer-timer-inner">
                  <div className={`lock-icon ${animPhase === "locking" ? "lock-animating" : animPhase === "locked" ? "lock-locked" : ""}`}>
                    {animPhase === "locked" ? "🔒" : animPhase === "locking" ? "🔓" : "🔓"}
                  </div>
                  <div className="timer-info">
                    <span className="timer-label">Draft phase</span>
                    <span className="timer-value">{formatTime(timerData.remaining)}</span>
                  </div>
                  <div className="timer-bar-track">
                    <div
                      className={`timer-bar-fill timer-bar-${timerUrgency}`}
                      style={{ width: `${Math.max(0, Math.min(100, timerPct * 100))}%` }}
                    />
                  </div>
                </div>
                {animPhase === "locking" && (
                  <div className="lock-transition-overlay">
                    <div className="lock-transition-text">Time's up! Locking drafts...</div>
                  </div>
                )}
              </div>

              {/* Draft thread */}
              <div className="draft-thread-area">
                {draftTree.length === 0 && (
                  <div className="draft-empty-state">
                    <div className="draft-empty-icon">✏️</div>
                    <p>No drafts yet. Be the first to propose a response.</p>
                  </div>
                )}
                {draftTree.map(renderDraftNode)}
                <div ref={draftsEndRef} />
              </div>

              {/* Draft input */}
              {animPhase !== "locking" && animPhase !== "locked" && (
                <div className="draft-input-area">
                  <textarea
                    className="draft-textarea"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Write a draft response for the group..."
                    rows={3}
                    autoFocus
                  />
                  <div className="draft-input-actions">
                    <span className="draft-hint">⌘+Enter to send</span>
                    <button
                      className="draft-send-btn"
                      onClick={handleSendDraft}
                      disabled={!draftText.trim()}
                    >
                      Send Draft
                    </button>
                  </div>
                </div>
              )}

              {/* Locked state */}
              {animPhase === "locked" && (
                <div className="draft-locked-overlay">
                  <div className="locked-icon">🔒</div>
                  <p>Draft phase has ended. Awaiting summaries...</p>
                </div>
              )}
            </div>
          )}

          {/* ── SUMMARIZING PHASE ── */}
          {isSummarizing && (
            <div className="composer-phase summarizing-phase">
              <div className="summarizing-indicator">
                <div className="summarizing-spinner" />
                <p>Generating summary candidates...</p>
                <p className="summarizing-sub">The LLM is synthesising all drafts into 2–3 response options.</p>
              </div>
            </div>
          )}

          {/* ── APPROVAL PHASE ── */}
          {isApproval && (
            <div className="composer-phase approval-phase">
              <div className="approval-header">
                <h3>Choose the group's response</h3>
                <p className="approval-subtitle">Vote on which summary should be published as the group's message.</p>
              </div>

              {summaries.length === 0 && (
                <div className="summaries-empty">
                  <div className="summarizing-spinner small" />
                  <p>Waiting for LLM summaries...</p>
                </div>
              )}

              <div className="summary-cards">
                {summaries.map((s) => (
                  <div
                    key={s.id}
                    className={`summary-card ${selectedSummary === s.id ? "selected" : ""}`}
                    onClick={() => handleVoteSummary(s.id)}
                  >
                    <div className="summary-card-badge">
                      {selectedSummary === s.id ? "✓ Selected" : "Vote"}
                    </div>
                    <div className="summary-card-content">{s.content}</div>
                  </div>
                ))}
              </div>

              {/* "Send nothing" option */}
              <div className="discard-option">
                <div
                  className={`summary-card discard-card ${selectedSummary === "discard" ? "selected" : ""}`}
                  onClick={handleVoteDiscard}
                >
                  <div className="summary-card-badge discard-badge">
                    {selectedSummary === "discard" ? "✓ Selected" : ""}
                  </div>
                  <div className="summary-card-content">
                    <strong>Don't send anything</strong>
                    <p className="discard-desc">Discard this impulse without publishing a response.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── BROADCAST PHASE ── */}
          {isBroadcast && broadcastMsg && (
            <div className={`composer-phase broadcast-phase ${broadcastAnim ? "broadcast-animating" : ""}`}>
              <div className="broadcast-celebration">
                <div className="broadcast-icon">📢</div>
                <h3>Message Published!</h3>
                <p className="broadcast-sub">The group's response has been broadcast.</p>
              </div>

              <div className="broadcast-message-card">
                <div className="broadcast-message-header">
                  <span className="broadcast-group">{groupName}</span>
                  <span className="broadcast-time">
                    {new Date().toLocaleDateString()}
                  </span>
                </div>
                <div className="broadcast-message-body">{broadcastMsg}</div>
              </div>
            </div>
          )}

          {/* ── DISCARDED ── */}
          {impulse.status === "discarded" && (
            <div className="composer-phase discarded-phase">
              <div className="discarded-banner">
                <span className="discarded-icon">—</span>
                <p>The group chose not to send a response.</p>
              </div>
              {summaries.length > 0 && (
                <div className="summary-cards dimmed">
                  {summaries.map((s) => (
                    <div key={s.id} className="summary-card dimmed">
                      <div className="summary-card-content">{s.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── EXPIRED ── */}
          {impulse.status === "expired" && (
            <div className="composer-phase expired-phase">
              <div className="expired-banner">
                <span>⏰</span>
                <p>Impulse window expired without enough drafts or support.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Close warning dialog ── */}
        {showCloseWarning && (
          <div className="composer-modal-warning" onClick={() => setShowCloseWarning(false)}>
            <div className="warning-dialog" onClick={(e) => e.stopPropagation()}>
              <h4>Close composer?</h4>
              <p>You are in the draft phase. Your unsent draft will be lost. Other members' drafts are not affected.</p>
              <div className="warning-actions">
                <button className="warning-cancel" onClick={() => setShowCloseWarning(false)}>
                  Keep drafting
                </button>
                <button className="warning-confirm" onClick={onClose}>
                  Close anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Broadcast confetti particles ── */}
        {broadcastAnim && (
          <div className="broadcast-particles">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="particle"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.5}s`,
                  animationDuration: `${0.8 + Math.random() * 0.6}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
