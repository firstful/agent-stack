"use client";

import { useState } from "react";
import type { Tally, TallyCohort } from "./group-detail-types";

interface VoteSectionProps {
  impulseId: string;
  tally?: Tally;
  timer?: string;
  localVote: "yes" | "no" | "abstain" | null;
  onVote: (impulseId: string, vote: "yes" | "no" | "abstain") => void;
  disabled?: boolean;
}

export function VoteSection({
  impulseId,
  tally,
  timer,
  localVote,
  onVote,
  disabled,
}: VoteSectionProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const yesWeight = tally?.totals.yesWeight ?? 0;
  const noWeight = tally?.totals.noWeight ?? 0;
  const totalWeight = yesWeight + noWeight;
  const yesPct = totalWeight > 0 ? (yesWeight / totalWeight) * 100 : 50;
  const totalVoters = tally?.totals.totalVoters ?? 0;
  const cohorts = tally?.cohorts ?? [];

  const handleVote = (vote: "yes" | "no" | "abstain") => {
    if (disabled || localVote !== null) return;
    onVote(impulseId, vote);
  };

  return (
    <div className="vote-section">
      {/* Weighted tally bar */}
      <div className="vote-bar-wrap">
        <div className="vote-bar">
          <div
            className="vote-fill vote-fill-yes"
            style={{ width: `${yesPct}%` }}
          />
          <div
            className="vote-fill vote-fill-no"
            style={{ width: `${100 - yesPct}%` }}
          />
        </div>
      </div>

      {/* Tally numbers */}
      <div className="vote-tally-row">
        <div className="vote-tally-group vote-tally-group--yes">
          <span className="vote-tally-value">{yesWeight.toFixed(1)}</span>
          <span className="vote-tally-pct">({yesPct.toFixed(0)}%)</span>
          <span className="vote-tally-label">Yes</span>
        </div>

        <div className="vote-tally-mid">
          {/* Timer if present */}
          {timer && (
            <span className={`vote-tally-timer ${yesWeight >= noWeight ? "" : "vote-tally-timer--leading-no"}`}>
              ⏱ {timer}
            </span>
          )}
          <span className="vote-tally-voters">
            {totalVoters} voted
          </span>
        </div>

        <div className="vote-tally-group vote-tally-group--no">
          <span className="vote-tally-value">{noWeight.toFixed(1)}</span>
          <span className="vote-tally-pct">({(100 - yesPct).toFixed(0)}%)</span>
          <span className="vote-tally-label">No</span>
        </div>
      </div>

      {/* Inline vote buttons */}
      <div className="vote-actions">
        <button
          className={`vote-btn vote-btn-yes ${localVote === "yes" ? "vote-btn--active" : ""} ${localVote === "no" || localVote === "abstain" ? "vote-btn--disabled" : ""}`}
          onClick={() => handleVote("yes")}
          disabled={disabled || localVote !== null}
          title="Vote Yes"
        >
          <span className="vote-btn-icon">👍</span>
          <span className="vote-btn-text">Yes</span>
        </button>
        <button
          className={`vote-btn vote-btn-no ${localVote === "no" ? "vote-btn--active" : ""} ${localVote === "yes" || localVote === "abstain" ? "vote-btn--disabled" : ""}`}
          onClick={() => handleVote("no")}
          disabled={disabled || localVote !== null}
          title="Vote No"
        >
          <span className="vote-btn-icon">👎</span>
          <span className="vote-btn-text">No</span>
        </button>
        <button
          className={`vote-btn vote-btn-abstain ${localVote === "abstain" ? "vote-btn--active" : ""}`}
          onClick={() => handleVote("abstain")}
          disabled={disabled || localVote !== null}
          title="Abstain"
        >
          <span className="vote-btn-icon">⏸</span>
          <span className="vote-btn-text">Abstain</span>
        </button>
      </div>

      {/* Tenure breakdown toggle */}
      {cohorts.length > 0 && (
        <div className="vote-breakdown">
          <button
            className="vote-breakdown-toggle"
            onClick={() => setShowBreakdown(!showBreakdown)}
          >
            {showBreakdown ? "▲" : "▼"} Tenure breakdown
          </button>

          {showBreakdown && (
            <div className="vote-breakdown-table">
              <div className="vote-breakdown-header">
                <span className="vote-breakdown-col vote-breakdown-col--range">Range</span>
                <span className="vote-breakdown-col vote-breakdown-col--yes">Yes</span>
                <span className="vote-breakdown-col vote-breakdown-col--no">No</span>
                <span className="vote-breakdown-col vote-breakdown-col--voters">Voters</span>
              </div>
              {cohorts.map((c: TallyCohort) => (
                <div key={c.range} className="vote-breakdown-row">
                  <span className="vote-breakdown-col vote-breakdown-col--range">
                    {c.range}
                  </span>
                  <span className="vote-breakdown-col vote-breakdown-col--yes">
                    {c.yesWeight.toFixed(1)}
                  </span>
                  <span className="vote-breakdown-col vote-breakdown-col--no">
                    {c.noWeight.toFixed(1)}
                  </span>
                  <span className="vote-breakdown-col vote-breakdown-col--voters">
                    {c.voterCount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Voted confirmation */}
      {localVote && (
        <div className="vote-confirmation">
          {localVote === "yes" && "✓ Voted Yes"}
          {localVote === "no" && "✓ Voted No"}
          {localVote === "abstain" && "✓ Abstained"}
        </div>
      )}
    </div>
  );
}
