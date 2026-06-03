"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { SkeletonDetail } from "@/components/SkeletonDetail";

type Vote = {
  id: string;
  vote: string;
  weight: number;
  userId: string;
};

type Impulse = {
  id: string;
  title: string;
  description: string;
  status: string;
  groupId: string;
  targetGroupId?: string;
  createdAt: string;
  votingEndsAt?: string;
  queuePosition?: number;
  votes?: Vote[];
};

type Draft = {
  id: string;
  content: string;
  parentDraftId?: string;
  createdAt: string;
  user: { id: string; username: string };
};

type Summary = {
  id: string;
  content: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  voting: "Voting",
  composing: "Drafting",
  summarizing: "Summarizing",
  approval: "Approval",
  broadcast: "✓ Broadcast",
  expired: "✗ Expired",
  discarded: "— Discarded",
};

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Ending now";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function ImpulseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [impulse, setImpulse] = useState<Impulse | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [draftText, setDraftText] = useState("");
  const [selectedSummary, setSelectedSummary] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");

  const load = useCallback(() => {
    api.impulse(id).then(setImpulse);
    api.drafts(id).then(setDrafts);
    api.summaries(id).then(setSummaries);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh during active phases
  useEffect(() => {
    const activePhases = ["queued", "voting", "composing", "summarizing", "approval"];
    if (!impulse || !activePhases.includes(impulse.status)) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [impulse?.status, load]);

  // Countdown timer for voting
  useEffect(() => {
    if (!impulse?.votingEndsAt) return;
    const update = () => {
      const remaining = new Date(impulse.votingEndsAt!).getTime() - Date.now();
      setTimeLeft(formatTimeLeft(Math.max(0, remaining)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [impulse?.votingEndsAt]);

  const handleSendDraft = async () => {
    if (!draftText.trim()) return;
    await api.sendDraft({ impulseId: id, content: draftText });
    setDraftText("");
    api.drafts(id).then(setDrafts);
  };

  const handleVoteSummary = async (summaryId: string) => {
    setSelectedSummary(summaryId);
    await api.vote({ impulseId: id, vote: "yes" });
  };

  if (!impulse) {
    return (
      <AppShell>
        <SkeletonDetail />
      </AppShell>
    );
  }

  const isVoting = impulse.status === "voting";
  const isComposing = impulse.status === "composing";
  const isApproval = impulse.status === "approval";
  const isActive = ["queued", "voting", "composing", "summarizing", "approval"].includes(impulse.status);
  const votes = impulse.votes || [];
  const yesWeight = votes.filter((v) => v.vote === "yes").reduce((s, v) => s + v.weight, 0);
  const noWeight = votes.filter((v) => v.vote === "no").reduce((s, v) => s + v.weight, 0);

  return (
    <AppShell>
    <div className="feed-view">
      <Link href={`/groups/${impulse.groupId}`} className="back-link">
        ← Back to group
      </Link>

      <div className="impulse-detail-header">
        <h1>{impulse.title}</h1>
        <span className={`impulse-status status-${impulse.status}`}>
          {STATUS_LABELS[impulse.status] || impulse.status}
        </span>
      </div>

      {impulse.description && <p className="impulse-desc">{impulse.description}</p>}

      <div className="impulse-meta-bar">
        {impulse.status === "queued" && impulse.queuePosition && (
          <span>Queue position: #{impulse.queuePosition}</span>
        )}
        {isVoting && timeLeft && (
          <span className="timer-display-vote">⏱ Voting closes in {timeLeft}</span>
        )}
        {impulse.status === "expired" && <span>⏰ Voting window expired without enough support</span>}
        {impulse.status === "broadcast" && <span>✓ This impulse was broadcast as a public message</span>}
        {impulse.status === "discarded" && <span>— The group chose not to send a response</span>}
      </div>

      {/* Vote tally */}
      {isActive && votes.length > 0 && (
        <div className="vote-tally">
          <div className="vote-row">
            <span className="vote-label">Yes</span>
            <div className="vote-bar-bg">
              <div
                className="vote-bar-fill vote-bar-yes"
                style={{ width: yesWeight + noWeight > 0 ? `${(yesWeight / (yesWeight + noWeight)) * 100}%` : "0%" }}
              />
            </div>
            <span className="vote-number">{yesWeight}</span>
          </div>
          <div className="vote-row">
            <span className="vote-label">No</span>
            <div className="vote-bar-bg">
              <div
                className="vote-bar-fill vote-bar-no"
                style={{ width: yesWeight + noWeight > 0 ? `${(noWeight / (yesWeight + noWeight)) * 100}%` : "0%" }}
              />
            </div>
            <span className="vote-number">{noWeight}</span>
          </div>
        </div>
      )}

      {/* Voting phase */}
      {isVoting && (
        <div className="vote-actions-detailed">
          <button
            onClick={() => api.vote({ impulseId: id, vote: "yes" }).then(load)}
            className="vote-btn-yes vote-btn-large"
          >
            👍 Yes
          </button>
          <button
            onClick={() => api.vote({ impulseId: id, vote: "no" }).then(load)}
            className="vote-btn-no vote-btn-large"
          >
            👎 No
          </button>
        </div>
      )}

      {/* Composer phase */}
      {isComposing && (
        <div className="composer-view">
          <div className="timer-display">
            ✏️ Draft phase — compose the group response
          </div>

          <div className="draft-thread">
            {drafts.length === 0 && (
              <p className="empty-state">No drafts yet. Be the first to contribute.</p>
            )}
            {drafts.map((d) => (
              <div key={d.id} className="draft-entry">
                <div className="author">{d.user.username}</div>
                <p>{d.content}</p>
                <div className="meta">
                  {new Date(d.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>

          <div className="draft-input">
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Add to the draft thread..."
              rows={3}
            />
            <button onClick={handleSendDraft}>Send Draft</button>
          </div>
        </div>
      )}

      {/* Approval phase */}
      {isApproval && (
        <div className="summary-stage">
          <h2>Select a response</h2>
          {summaries.length === 0 && (
            <p className="empty-state">Waiting for LLM summaries...</p>
          )}
          {summaries.map((s) => (
            <div
              key={s.id}
              className={`summary-option ${selectedSummary === s.id ? "selected" : ""}`}
              onClick={() => handleVoteSummary(s.id)}
            >
              <p>{s.content}</p>
              <div className="meta">
                {selectedSummary === s.id ? "✓ Selected" : "Click to vote"}
              </div>
            </div>
          ))}
          <div
            className={`summary-option discard ${selectedSummary === "discard" ? "selected" : ""}`}
            onClick={() => {
              setSelectedSummary("discard");
              api.vote({ impulseId: id, vote: "no" });
            }}
          >
            <p>Don't send anything</p>
          </div>
        </div>
      )}

      {/* Broadcast state */}
      {impulse.status === "broadcast" && (
        <div className="broadcast-success">
          {summaries.length > 0 && (
            <div className="broadcast-message">
              <p>{summaries[0].content}</p>
            </div>
          )}
        </div>
      )}
    </div>
    </AppShell>
  );
}
