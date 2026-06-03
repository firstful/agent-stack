"use client";

import type { Member, Impulse } from "./group-detail-types";
import { tenureDays, tenureLabel, tenureBarWidth, tenureCohort } from "./group-detail-types";

interface QueueDisplayProps {
  impulse: Impulse;
  members: Member[];
  queuePosition: number;
  totalQueued: number;
}

export function QueueDisplay({ impulse, members, queuePosition, totalQueued }: QueueDisplayProps) {
  const creatorMembership = members.find((m) => m.userId === impulse.createdBy);
  const creatorTenure = creatorMembership ? tenureDays(creatorMembership.joinedAt) : 0;
  const cohort = tenureCohort(creatorTenure);
  const barWidth = tenureBarWidth(creatorTenure);

  return (
    <div className="queue-display">
      {/* Position badge */}
      <div className="queue-display-position">
        <span className="queue-display-number">#{queuePosition}</span>
        <span className="queue-display-of">of {totalQueued}</span>
      </div>

      {/* Queue position bar */}
      <div className="queue-display-bar-wrap">
        <div
          className="queue-display-bar-fill"
          style={{
            width: `${(queuePosition / Math.max(1, totalQueued)) * 100}%`,
            background: cohort.color,
          }}
        />
      </div>

      {/* Tenure info */}
      <div className="queue-display-tenure">
        <div className="queue-display-tenure-header">
          <span className="queue-display-tenure-label">Creator tenure</span>
          <span
            className="queue-display-tenure-value"
            style={{ color: cohort.color }}
          >
            {tenureLabel(creatorTenure)}
          </span>
        </div>
        <div className="tenure-bar-wrap queue-display-tenure-bar">
          <div
            className="tenure-bar-fill"
            style={{ width: `${barWidth}%`, background: cohort.color }}
          />
        </div>
        <span className="queue-display-cohort-label" style={{ color: cohort.color }}>
          {cohort.label}
        </span>
      </div>

      {/* Status text */}
      <div className="queue-display-status">
        <span className="queue-display-status-text">
          {queuePosition === 1
            ? "Next in queue — advancing to voting"
            : `Waiting behind ${queuePosition - 1} impulse${queuePosition - 1 !== 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}
