"use client";

import Link from "next/link";
import type { Impulse, Group, Member, Tally } from "./group-detail-types";
import { STATUS_LABELS, STATUS_COLORS, tenureDays, tenureLabel } from "./group-detail-types";
import { QueueDisplay } from "./QueueDisplay";
import { AdaptiveTimer } from "./AdaptiveTimer";
import { VoteSection } from "./VoteSection";
import { useState, useMemo } from "react";
import {
  adaptiveRemaining,
  MAX_VOTING_WINDOW,
  tenureWeight,
  sortQueue,
  assignQueuePositions,
  type QueuedImpulse,
} from "@groupthink/shared";

interface ImpulseCardProps {
  impulse: Impulse;
  group: Group;
  members: Member[];
  userId: string | null;
  tally?: Tally;
  timer?: string;
  queuedPositions: Record<string, number>;
  totalQueued: number;
  onVote: (id: string, vote: "yes" | "no" | "abstain") => void;
  onRefresh: () => void;
  onOpenComposer?: (id: string) => void;
}

export function ImpulseCard({
  impulse,
  group,
  members,
  userId,
  tally,
  timer,
  queuedPositions,
  totalQueued,
  onVote,
  onRefresh,
  onOpenComposer,
}: ImpulseCardProps) {
  const [localVote, setLocalVote] = useState<"yes" | "no" | "abstain" | null>(null);

  const status = impulse.status;
  const isQueued = status === "queued";
  const isVoting = status === "voting";
  const isComposing = status === "composing";
  const isSummarizing = status === "summarizing";
  const isApproval = status === "approval";
  const isBroadcast = status === "broadcast";
  const isModalPhase = isComposing || isSummarizing || isApproval || isBroadcast;

  const creatorMembership = members.find((m) => m.userId === impulse.createdBy);
  const creatorTenure = creatorMembership ? tenureDays(creatorMembership.joinedAt) : 0;
  const queuePosition = queuedPositions[impulse.id] ?? impulse.queuePosition ?? 0;

  const handleVote = async (vote: "yes" | "no" | "abstain") => {
    setLocalVote(vote);
    await onVote(impulse.id, vote);
  };

  return (
    <div className={`impulse-card ${isVoting ? "impulse-card--voting" : ""} ${isQueued ? "impulse-card--queued" : ""}`}>
      {/* Card header */}
      <div className="impulse-card-header">
        <Link
          href={`/impulses/${impulse.id}`}
          className="impulse-card-title"
        >
          {impulse.title}
        </Link>
        <span
          className="status-pill"
          style={{
            borderColor: STATUS_COLORS[status] || "var(--border)",
            color: STATUS_COLORS[status] || "var(--text-muted)",
          }}
        >
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      {/* Description */}
      {impulse.description && (
        <p className="impulse-card-desc">{impulse.description}</p>
      )}

      {/* Creator + target info */}
      <div className="meta">
        <span className="meta-creator">
          By {members.find((m) => m.userId === impulse.createdBy)?.user?.username ?? "Unknown"}
          {" — "}
          <span className="meta-tenure" title={`Member for ${tenureLabel(creatorTenure)}`}>
            {tenureLabel(creatorTenure)}
          </span>
        </span>
        {impulse.targetGroupId && (
          <span className="meta-target">→ targets another group</span>
        )}
      </div>

      {/* ── Tenure-weighted Queue Display ── */}
      {isQueued && (
        <QueueDisplay
          impulse={impulse}
          members={members}
          queuePosition={queuePosition}
          totalQueued={totalQueued}
        />
      )}

      {/* ── Voting Phase: Adaptive Timer + Vote Section ── */}
      {isVoting && (
        <div className="impulse-card-voting-section">
          <AdaptiveTimer
            remainingMs={timer ? parseTimerToMs(timer) : MAX_VOTING_WINDOW}
            totalMs={MAX_VOTING_WINDOW}
            label="Voting"
          />
          <VoteSection
            impulseId={impulse.id}
            tally={tally}
            timer={timer}
            localVote={localVote}
            onVote={handleVote}
          />
        </div>
      )}

      {/* ── Composing Phase ── */}
      {isComposing && (
        <div className="impulse-card-composing">
          <span className="phase-info">✏️ Composing phase — drafts in progress</span>
          {onOpenComposer && (
            <button
              className="phase-enter-btn"
              onClick={() => onOpenComposer(impulse.id)}
            >
              Enter composer
            </button>
          )}
        </div>
      )}

      {/* ── Summarizing / Approval / Broadcast phases ── */}
      {isSummarizing && (
        <div className="impulse-card-phase-info">
          <span className="phase-info">🤖 LLM generating summaries...</span>
        </div>
      )}
      {isApproval && onOpenComposer && (
        <div className="impulse-card-phase-info">
          <span className="phase-info">🗳 Approval phase — vote on summaries</span>
          <button
            className="phase-enter-btn"
            onClick={() => onOpenComposer(impulse.id)}
          >
            View & vote
          </button>
        </div>
      )}
      {isBroadcast && (
        <div className="impulse-card-phase-info">
          <span className="phase-info phase-info--broadcast">
            ✓ Broadcast as public message
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Best-effort parse of the formatted timer string back to milliseconds.
 * The format is what formatTimeLeft produces: "Xh Xm Xs" or "Xs"
 */
function parseTimerToMs(timer: string): number {
  const hMatch = timer.match(/(\d+)h/);
  const mMatch = timer.match(/(\d+)m/);
  const sMatch = timer.match(/(\d+)s/);
  let ms = 0;
  if (hMatch) ms += parseInt(hMatch[1]) * 3600000;
  if (mMatch) ms += parseInt(mMatch[1]) * 60000;
  if (sMatch) ms += parseInt(sMatch[1]) * 1000;
  if (ms === 0 && timer === "Ending now") return 0;
  return ms || MAX_VOTING_WINDOW;
}
