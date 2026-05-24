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

type Impulse = {
  id: string;
  title: string;
  description: string;
  status: string;
  queuePosition: number;
  createdBy: string;
  createdAt: string;
  votingEndsAt?: string;
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

  useEffect(() => { load(); }, [load]);

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
        <span className="tier-badge">{group.tier}</span>
        <span className="energy-badge">{group.energy}</span>
        {group.timezone && <span className="tz-badge">{group.timezone}</span>}
      </div>

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
            {impulses.map((imp) => (
              <Link key={imp.id} href={`/impulses/${imp.id}`} className="impulse-card">
                <h3>{imp.title}</h3>
                <div className="meta">
                  {imp.status} · position {imp.queuePosition}
                </div>
                {imp.description && <p>{imp.description}</p>}
                <div className="vote-bar">
                  <div className="vote-fill" style={{ width: "0%" }} />
                </div>
                <div className="vote-actions">
                  <button onClick={(e) => { e.preventDefault(); api.vote({ impulseId: imp.id, vote: "yes" }); }}>Yes</button>
                  <button onClick={(e) => { e.preventDefault(); api.vote({ impulseId: imp.id, vote: "no" }); }}>No</button>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {tab === "members" && (
        <div className="members-list">
          {members.map((m) => (
            <div key={m.id} className="draft-entry">
              <div className="author">{m.user.username}</div>
              <p className="meta">Joined {new Date(m.joinedAt).toLocaleDateString()}</p>
            </div>
          ))}
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
