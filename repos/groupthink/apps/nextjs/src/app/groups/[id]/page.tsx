"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

type Group = {
  id: string;
  name: string;
  bio: string;
  energy: string;
  tier: string;
  memberCount: number;
  timezone?: string;
  sabbaticalUntil?: string;
  createdAt: string;
};

type Member = {
  id: string;
  joinedAt: string;
  user: { id: string; username: string };
};

type UserInfo = {
  id: string;
  username: string;
  createdAt: string;
};

type Impulse = {
  id: string;
  title: string;
  description: string;
  status: string;
  queuePosition: number;
  createdBy: string;
  createdAt: string;
  votingEndsAt?: string;
  votes?: { id: string; vote: string; weight: number; userId: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  queued: "#6b7280",
  voting: "#f59e0b",
  composing: "#3b82f6",
  summarizing: "#8b5cf6",
  approval: "#10b981",
  broadcast: "#059669",
  expired: "#ef4444",
  discarded: "#9ca3af",
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

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [impulses, setImpulses] = useState<Impulse[]>([]);
  const [inviteCodes, setInviteCodes] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tab, setTab] = useState<"impulses" | "members" | "settings">("impulses");

  const load = useCallback(() => {
    api.group(id).then(setGroup);
    api.groupMembers(id).then(setMembers);
    api.impulses(id).then(setImpulses);
  }, [id]);

  // Load on mount
  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 8s to pick up lifecycle engine transitions
  useEffect(() => {
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCreateImpulse = async () => {
    await api.createImpulse(id, { title, description });
    setShowForm(false);
    setTitle("");
    setDescription("");
    api.impulses(id).then(setImpulses);
  };

  const loadInviteCodes = async () => {
    try {
      const codes = await api.inviteCodes(id);
      setInviteCodes(codes);
      setShowInvites(true);
    } catch (e) {
      // not a member
    }
  };

  const generateCode = async () => {
    await api.generateInviteCode(id);
    loadInviteCodes();
  };

  if (!group) return <div className="feed-view">Loading...</div>;

  const onSabbatical =
    group.sabbaticalUntil && new Date(group.sabbaticalUntil) > new Date();

  const isFringe = group.tier === "fringe";

  return (
    <div className="group-detail-view">
      {onSabbatical && (
        <div className="sabbatical-banner">
          Group is on sabbatical until{" "}
          {new Date(group.sabbaticalUntil!).toLocaleDateString()} — no new
          impulses or voting.
        </div>
      )}

      <div className="group-detail-header">
        <h1>{group.name}</h1>
        <span className={`tier-badge tier-${group.tier}`}>{group.tier}</span>
        <span className={`energy-badge energy-${group.energy}`}>{group.energy}</span>
        {group.timezone && <span className="tz-badge">{group.timezone}</span>}
      </div>
      <div className="group-detail-meta">{group.memberCount} members</div>

      {isFringe && (
        <div className="fringe-notice">
          This group is fringe-tier — it will become visible globally once it reaches 5 members.
        </div>
      )}

      {group.bio && <p className="group-bio">{group.bio}</p>}

      <div className="impulse-tabs">
        <button className={tab === "impulses" ? "active" : ""} onClick={() => setTab("impulses")}>
          Impulses
        </button>
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
          Members ({members.length})
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "impulses" && (
        <>
          {!onSabbatical && (
            <button
              className="new-impulse-btn"
              onClick={() => setShowForm(!showForm)}
            >
              + New Impulse
            </button>
          )}

          {showForm && (
            <div className="impulse-form">
              <input
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <button onClick={handleCreateImpulse}>Submit Impulse</button>
            </div>
          )}

          <div className="impulses-list">
            {impulses.length === 0 && (
              <p className="empty-state">No impulses yet. Create one to start.</p>
            )}
            {impulses.map((imp) => {
              const votes = imp.votes || [];
              const yesVotes = votes.filter((v) => v.vote === "yes").length;
              const noVotes = votes.filter((v) => v.vote === "no").length;
              const totalVotes = yesVotes + noVotes;
              const yesPercent = totalVotes > 0 ? (yesVotes / totalVotes) * 100 : 0;

              return (
                <Link key={imp.id} href={`/impulses/${imp.id}`} className="impulse-card">
                  <div className="impulse-card-header">
                    <h3>{imp.title}</h3>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[imp.status] || "#6b7280" }}
                    >
                      {STATUS_LABELS[imp.status] || imp.status}
                    </span>
                  </div>
                  <div className="meta">
                    {imp.status === "queued" && (
                      <span>Position #{imp.queuePosition} in queue</span>
                    )}
                    {imp.status === "voting" && imp.votingEndsAt && (
                      <span>Voting ends {new Date(imp.votingEndsAt).toLocaleTimeString()}</span>
                    )}
                    {imp.status === "voting" && !imp.votingEndsAt && (
                      <span>Voting phase — cast your vote</span>
                    )}
                    {imp.status === "composing" && <span>Draft phase — contribute to the thread</span>}
                    {imp.status === "approval" && <span>Reviewing LLM summaries</span>}
                    {imp.status === "broadcast" && <span>Message published</span>}
                    {imp.status === "expired" && <span>Did not reach threshold</span>}
                    <span className="created-at">· {new Date(imp.createdAt).toLocaleDateString()}</span>
                  </div>
                  {imp.description && <p>{imp.description}</p>}

                  {/* Vote bar */}
                  {imp.status === "voting" && (
                    <div className="vote-bar-container">
                      <div className="vote-bar">
                        <div className="vote-fill-yes" style={{ width: `${yesPercent}%` }} />
                      </div>
                      <div className="vote-counts">
                        {totalVotes > 0 ? `${yesVotes} yes · ${noVotes} no` : "No votes yet"}
                      </div>
                    </div>
                  )}

                  {imp.status !== "broadcast" && imp.status !== "expired" && imp.status !== "discarded" && (
                    <div className="vote-actions">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          api.vote({ impulseId: imp.id, vote: "yes" }).then(load);
                        }}
                        className="vote-btn-yes"
                      >
                        Yes {yesVotes > 0 && `(${yesVotes})`}
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          api.vote({ impulseId: imp.id, vote: "no" }).then(load);
                        }}
                        className="vote-btn-no"
                      >
                        No {noVotes > 0 && `(${noVotes})`}
                      </button>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {tab === "members" && (
        <div className="members-list">
          {members.map((m) => {
            const daysSinceJoining = Math.floor(
              (Date.now() - new Date(m.joinedAt).getTime()) / 86400000
            );
            return (
              <div key={m.id} className="draft-entry">
                <div className="author">{m.user.username}</div>
                <p className="meta">
                  Member for {Math.max(1, daysSinceJoining)} day{daysSinceJoining !== 0 ? "s" : ""}
                  {m.isVouched && " · vouched"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "settings" && (
        <div className="settings-panel">
          <button onClick={loadInviteCodes} className="btn" style={{ marginBottom: 16 }}>
            View Invite Codes
          </button>

          {showInvites && (
            <div className="invite-codes-section">
              <h3>Unused Invite Codes</h3>
              <div className="invite-code-list">
                {inviteCodes.map((ic: any) => (
                  <code key={ic.id} className="invite-code">{ic.code}</code>
                ))}
                {inviteCodes.length === 0 && <p className="empty">No unused codes</p>}
              </div>
              {inviteCodes.length < 5 && (
                <button onClick={generateCode}>Generate New Code</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
