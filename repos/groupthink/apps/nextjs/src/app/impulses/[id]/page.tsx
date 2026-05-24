"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

type Impulse = {
  id: string;
  title: string;
  description: string;
  status: string;
  groupId: string;
  targetGroupId?: string;
  createdAt: string;
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
};

export default function ImpulseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [impulse, setImpulse] = useState<Impulse | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [draftText, setDraftText] = useState("");
  const [selectedSummary, setSelectedSummary] = useState<string | null>(null);

  useEffect(() => {
    api.impulse(id).then(setImpulse);
    api.drafts(id).then(setDrafts);
    api.summaries(id).then(setSummaries);
  }, [id]);

  const handleSendDraft = async () => {
    if (!draftText.trim()) return;
    await api.sendDraft({ impulseId: id, content: draftText });
    setDraftText("");
    api.drafts(id).then(setDrafts);
  };

  const handleVoteSummary = async (summaryId: string) => {
    setSelectedSummary(summaryId);
    // In a full implementation this would hit a vote endpoint
  };

  if (!impulse) return <div className="feed-view">Loading...</div>;

  const isComposing = impulse.status === "composing";
  const isApproval = impulse.status === "approval";

  return (
    <div className="feed-view">
      <Link href={`/groups/${impulse.groupId}`} className="back-link">
        ← Back to group
      </Link>

      <h1>{impulse.title}</h1>
      {impulse.description && <p className="impulse-desc">{impulse.description}</p>}
      <div className="meta">Status: {impulse.status}</div>

      {isComposing && (
        <div className="composer-view">
          <div className="timer-display">
            Draft phase — timer will adapt based on engagement
          </div>

          <div className="draft-thread">
            {drafts.map((d) => (
              <div key={d.id} className="draft-entry">
                <div className="author">{d.user.username}</div>
                <p>{d.content}</p>
              </div>
            ))}
          </div>

          <div className="draft-input">
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Add to the draft thread..."
            />
            <button onClick={handleSendDraft}>Send</button>
          </div>
        </div>
      )}

      {isApproval && (
        <div className="summary-stage">
          <h2>Select a response</h2>
          {summaries.map((s) => (
            <div
              key={s.id}
              className={`summary-option ${selectedSummary === s.id ? "selected" : ""}`}
              onClick={() => handleVoteSummary(s.id)}
            >
              <p>{s.content}</p>
              <div className="vote-count">Click to vote for this option</div>
            </div>
          ))}
          <div
            className={`summary-option discard ${selectedSummary === "discard" ? "selected" : ""}`}
            onClick={() => setSelectedSummary("discard")}
          >
            <p>Don't send anything</p>
          </div>
        </div>
      )}
    </div>
  );
}
