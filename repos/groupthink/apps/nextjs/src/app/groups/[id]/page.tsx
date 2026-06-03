"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { EnergyBadge } from "@/components/EnergyBadge";
import { SkeletonGroupDetail } from "@/components/SkeletonGroupDetail";
import { ComposerModal } from "@/components/ComposerModal";
import { ImpulseForm } from "@/components/ImpulseForm";
import { ImpulseCard } from "@/components/ImpulseCard";
import {
  adaptiveRemaining,
  MAX_VOTING_WINDOW,
  assignQueuePositions,
  type QueuedImpulse,
} from "@groupthink/shared";
import {
  type Group,
  type Member,
  type Impulse,
  type Tally,
  type TallyCohort,
  type GroupBlock,
  type KickVote,
  type SplitVote,
  type MergeVote,
  type SabbaticalVote,
  STATUS_LABELS,
  STATUS_COLORS,
  TIER_ORDER,
  ENERGY_OPTIONS,
  TIMEZONE_OPTIONS,
  tenureDays,
  tenureLabel,
  tenureBarWidth,
  tenureCohort,
  tenureDaysFromCreation,
  formatTimeLeft,
} from "@/components/group-detail-types";


// ── Component ──

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();

  // Data
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [impulses, setImpulses] = useState<Impulse[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [blocks, setBlocks] = useState<GroupBlock[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"impulses" | "members" | "settings" | "governance">("impulses");
  const [filterStatus, setFilterStatus] = useState("");

  // Polling refs
  const tallyIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Tally cache: impulseId -> Tally
  const [tallies, setTallies] = useState<Record<string, Tally>>({});

  // Timer cache: impulseId -> remaining string
  const [timers, setTimers] = useState<Record<string, string>>({});

  // User ID for vote detection
  const [userId, setUserId] = useState<string | null>(null);

  // Composer modal state
  const [composingImpulseId, setComposingImpulseId] = useState<string | null>(null);
  const composerImpulse = useMemo(
    () => impulses.find((i) => i.id === composingImpulseId) ?? null,
    [impulses, composingImpulseId]
  );

  // Settings form state
  const [settingsBio, setSettingsBio] = useState("");
  const [settingsEnergy, setSettingsEnergy] = useState("");
  const [settingsTz, setSettingsTz] = useState("");
  const [settingsMinTier, setSettingsMinTier] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: "saved" | "error"; text: string } | null>(null);

  // Energy cooldown
  const [cooldownHours, setCooldownHours] = useState<number>(0);

  // Member search
  const [memberSearch, setMemberSearch] = useState("");

  // ── Governance state ──
  // Kick
  const [kickTargetUserId, setKickTargetUserId] = useState("");
  const [kickReason, setKickReason] = useState("");
  const [kickProcessing, setKickProcessing] = useState(false);
  const [activeKickVote, setActiveKickVote] = useState<KickVote | null>(null);
  const [kickVotes, setKickVotes] = useState<KickVote[]>([]);

  // Split
  const [splitNewName, setSplitNewName] = useState("");
  const [splitProcessing, setSplitProcessing] = useState(false);
  const [activeSplitVote, setActiveSplitVote] = useState<SplitVote | null>(null);

  // Merge
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeProcessing, setMergeProcessing] = useState(false);
  const [activeMergeVote, setActiveMergeVote] = useState<MergeVote | null>(null);

  // Sabbatical
  const [sabbDuration, setSabbDuration] = useState(48);
  const [sabbProcessing, setSabbProcessing] = useState(false);
  const [activeSabbaticalVote, setActiveSabbaticalVote] = useState<SabbaticalVote | null>(null);

  // ── Load user ID from localStorage ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      setUserId(localStorage.getItem("gt-user-id"));
    }
  }, []);

  // ── Load all data ──
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [g, m, imps, grps] = await Promise.all([
        api.group(id),
        api.groupMembers(id),
        api.impulses(id, filterStatus || undefined),
        api.groups(),
      ]);

      setGroup(g);
      setMembers(m);
      setImpulses(imps);
      setAllGroups(grps);

      // Sync settings form fields
      setSettingsBio(g.bio || "");
      setSettingsEnergy(g.energy || "thoughtful");
      setSettingsTz(g.timezone || "");
      setSettingsMinTier(g.minInteractionTier || "fringe");

      // Calculate cooldown
      if (g.lastEnergyChangeAt) {
        const hoursSince = (Date.now() - new Date(g.lastEnergyChangeAt).getTime()) / 3600000;
        setCooldownHours(Math.max(0, Math.ceil(72 - hoursSince)));
      }

      // Load blocks if available
      try {
        const fetchedBlocks = await api.groupBlocks(id);
        setBlocks(Array.isArray(fetchedBlocks) ? fetchedBlocks : []);
      } catch {
        // blocks endpoint may not be reachable
      }
    } catch (e) {
      console.error("group detail load error", e);
    } finally {
      setLoading(false);
    }
  }, [id, filterStatus]);

  // ── Tenure-weighted queue positions ──
  const queuedPositions = useMemo(() => {
    const queued = impulses.filter((i) => i.status === "queued");
    const withTenure: QueuedImpulse[] = queued.map((i) => {
      const creator = members.find((m) => m.userId === i.createdBy);
      return {
        id: i.id,
        createdBy: i.createdBy,
        createdAt: new Date(i.createdAt),
        tenureDays: creator ? tenureDays(creator.joinedAt) : 0,
      };
    });
    const positioned = assignQueuePositions(withTenure);
    const map: Record<string, number> = {};
    for (const p of positioned) map[p.id] = p.position;
    return map;
  }, [impulses, members]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  // ── Load governance votes ──
  const loadGovernance = useCallback(async () => {
    if (!id) return;
    try {
      // Fetch kick votes — the API returns active ones
      // We check for active kick votes by scanning for active status
      const allKickVotes = await api.search(`kick-votes:${id}`).catch(() => []);
      // Actually, we need a better approach. Let's query the group's kick votes
      // The API doesn't have a list-all-kick-votes endpoint.
      // Let's keep track via local state after initiating.
    } catch {}
  }, [id]);

  // Auto-refresh impulses during active phases
  useEffect(() => {
    const activeStatuses = new Set(["queued", "voting", "composing"]);
    const hasActive = impulses.some((i) => activeStatuses.has(i.status));
    if (!hasActive) return;
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [impulses, load]);

  // ── Fetch tally for voting impulses ──
  const fetchTally = useCallback(async (impulseId: string) => {
    try {
      const t = await api.tally(impulseId);
      setTallies((prev) => ({ ...prev, [impulseId]: t }));
    } catch {
      // tally fetch failed silently
    }
  }, []);

  // Fetch tallies for all voting impulses on mount/refresh
  useEffect(() => {
    const votingImps = impulses.filter((i) => i.status === "voting");
    if (votingImps.length === 0) {
      setTallies({});
      return;
    }
    votingImps.forEach((i) => fetchTally(i.id));

    // Set up polling for each voting impulse
    votingImps.forEach((imp) => {
      if (!tallyIntervals.current.has(imp.id)) {
        const interval = setInterval(() => fetchTally(imp.id), 5000);
        tallyIntervals.current.set(imp.id, interval);
      }
    });

    // Clean up intervals for non-voting impulses
    tallyIntervals.current.forEach((interval, impId) => {
      if (!votingImps.find((i) => i.id === impId)) {
        clearInterval(interval);
        tallyIntervals.current.delete(impId);
      }
    });

    return () => {
      tallyIntervals.current.forEach((interval) => clearInterval(interval));
      tallyIntervals.current.clear();
    };
  }, [impulses, fetchTally]);

  // ── Adaptive timer countdown ──
  useEffect(() => {
    if (!impulses.length) return;

    const votingImps = impulses.filter((i) => i.status === "voting");

    const updateTimers = () => {
      const now = Date.now();
      const newTimers: Record<string, string> = {};

      for (const imp of votingImps) {
        const elapsedMs = now - new Date(imp.createdAt).getTime();
        const tally = tallies[imp.id];
        let remainingMs: number;

        if (tally) {
          const groupMemberCount = members.length || 1;
          remainingMs = adaptiveRemaining({
            totalMembers: groupMemberCount,
            votesCast: tally.totals.totalVoters,
            yesVotes: tally.totals.yesWeight,
            noVotes: tally.totals.noWeight,
            elapsedMs,
          });
        } else {
          remainingMs = Math.max(0, MAX_VOTING_WINDOW - elapsedMs);
        }

        newTimers[imp.id] = formatTimeLeft(remainingMs);
      }

      setTimers(newTimers);
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);
    return () => clearInterval(interval);
  }, [impulses, members.length, tallies]);

  // ── Vote ──
  const handleVote = async (impulseId: string, vote: "yes" | "no" | "abstain") => {
    try {
      await api.vote({ impulseId, vote });
      await fetchTally(impulseId);
      await load();
    } catch (err: any) {
      console.error("vote error", err);
    }
  };

  // ── Leave group ──
  const handleLeave = async () => {
    if (!confirm("Leave this group?")) return;
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/api/groups/${id}/leave`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": localStorage.getItem("gt-user-id") ?? "",
          },
        }
      );
      window.location.href = "/";
    } catch (err: any) {
      console.error("leave error", err);
    }
  };

  // ── Save settings ──
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsMessage(null);
    try {
      const data: Record<string, string> = {};
      if (settingsBio !== (group?.bio || "")) data.bio = settingsBio;
      if (settingsEnergy !== group?.energy) data.energy = settingsEnergy;
      if (settingsTz !== (group?.timezone || "")) data.timezone = settingsTz;
      if (settingsMinTier !== (group?.minInteractionTier || "fringe")) data.minInteractionTier = settingsMinTier;

      if (Object.keys(data).length === 0) {
        setSettingsMessage({ type: "saved", text: "No changes to save" });
        setSettingsSaving(false);
        return;
      }

      await api.updateGroupSettings(id, data);
      setSettingsMessage({ type: "saved", text: "Settings saved successfully" });
      await load();
    } catch (err: any) {
      setSettingsMessage({ type: "error", text: err.message || "Failed to save settings" });
    } finally {
      setSettingsSaving(false);
    }
  };

  // ── Governance: Initiate Kick ──
  const handleInitiateKick = async () => {
    if (!kickTargetUserId) return;
    setKickProcessing(true);
    try {
      const vote = await api.initiateKick(id, kickTargetUserId, kickReason || undefined);
      setActiveKickVote(vote);
      setKickTargetUserId("");
      setKickReason("");
    } catch (err: any) {
      alert(err.message || "Failed to initiate kick vote");
    } finally {
      setKickProcessing(false);
    }
  };

  // ── Governance: Vote on Kick ──
  const handleVoteKick = async (kickVoteId: string, vote: "yes" | "no" | "abstain") => {
    try {
      const result = await api.voteOnKick(kickVoteId, vote);
      const updated = await api.getKickVote(kickVoteId);
      setActiveKickVote(updated);
    } catch (err: any) {
      alert(err.message || "Failed to cast vote");
    }
  };

  // ── Governance: Initiate Split ──
  const handleInitiateSplit = async () => {
    if (!splitNewName.trim()) return;
    setSplitProcessing(true);
    try {
      const vote = await api.initiateSplit(id, splitNewName.trim());
      setActiveSplitVote(vote);
      setSplitNewName("");
    } catch (err: any) {
      alert(err.message || "Failed to initiate split vote");
    } finally {
      setSplitProcessing(false);
    }
  };

  // ── Governance: Select Split Side ──
  const handleSelectSplit = async (splitVoteId: string, chooseOriginal: boolean) => {
    try {
      await api.selectSplit(splitVoteId, chooseOriginal);
      const updated = await api.getSplitVote(splitVoteId);
      setActiveSplitVote(updated);
    } catch (err: any) {
      alert(err.message || "Failed to register selection");
    }
  };

  // ── Governance: Initiate Merge ──
  const handleInitiateMerge = async () => {
    if (!mergeTargetId) return;
    setMergeProcessing(true);
    try {
      const vote = await api.initiateMerge(id, mergeTargetId);
      setActiveMergeVote(vote);
      setMergeTargetId("");
    } catch (err: any) {
      alert(err.message || "Failed to initiate merge");
    } finally {
      setMergeProcessing(false);
    }
  };

  // ── Governance: Approve/Reject Merge ──
  const handleApproveMerge = async (mergeVoteId: string, approved: boolean) => {
    try {
      await api.approveMerge(mergeVoteId, approved);
      const updated = await api.getMergeVote(mergeVoteId);
      setActiveMergeVote(updated);
    } catch (err: any) {
      alert(err.message || "Failed to register approval");
    }
  };

  // ── Governance: Initiate Sabbatical ──
  const handleInitiateSabbatical = async (direction: "enter" | "exit") => {
    setSabbProcessing(true);
    try {
      const vote = await api.initiateSabbatical(id, direction, direction === "enter" ? sabbDuration : undefined);
      setActiveSabbaticalVote(vote);
    } catch (err: any) {
      alert(err.message || "Failed to initiate sabbatical vote");
    } finally {
      setSabbProcessing(false);
    }
  };

  // ── Governance: Vote on Sabbatical ──
  const handleVoteSabbatical = async (sabbaticalVoteId: string, vote: "yes" | "no" | "abstain") => {
    try {
      await api.voteOnSabbatical(sabbaticalVoteId, vote);
      const updated = await api.getSabbaticalVote(sabbaticalVoteId);
      setActiveSabbaticalVote(updated);
      // Refresh group data which includes sabbaticalUntil
      await load();
    } catch (err: any) {
      alert(err.message || "Failed to cast vote");
    }
  };

  // ── Loading state ──
  if (loading || !group) {
    return (
      <AppShell>
        <SkeletonGroupDetail />
      </AppShell>
    );
  }

  const tierIdx = TIER_ORDER.indexOf(group.tier);
  const isSabbatical =
    group.sabbaticalUntil && new Date(group.sabbaticalUntil).getTime() > Date.now();

  const filteredImpulses = useMemo(() => {
    const f = filterStatus
      ? impulses.filter((i) => i.status === filterStatus)
      : impulses;
    return [...f].sort((a, b) => {
      const aPos = queuedPositions[a.id];
      const bPos = queuedPositions[b.id];
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos !== undefined) return -1;
      if (bPos !== undefined) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [impulses, filterStatus, queuedPositions]);

  // Member search filter
  const filteredMembers = memberSearch
    ? members.filter((m) =>
        m.user.username.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members;

  // Check if current user is a member
  const currentMember = members.find((m) => m.userId === userId);
  const isMember = !!currentMember;

  return (
    <AppShell>
      <div className="group-detail-view">
        {/* Sabbatical banner */}
        {isSabbatical && (
          <div className="sabbatical-banner">
            🛌 This group is on sabbatical until{" "}
            {new Date(group.sabbaticalUntil!).toLocaleDateString()}
          </div>
        )}

        {/* Group header */}
        <div className="group-detail-header">
          <h1>{group.name}</h1>
          <span className="tier-badge">{group.tier}</span>
          <EnergyBadge energy={group.energy} />
          {group.timezone && <span className="tz-badge">{group.timezone}</span>}
          <span className="member-count-badge">{group.memberCount} members</span>
        </div>

        {group.bio && <p className="group-bio-detail">{group.bio}</p>}

        {/* Tab navigation */}
        <div className="impulse-tabs">
          <button
            className={activeTab === "impulses" ? "active" : ""}
            onClick={() => setActiveTab("impulses")}
          >
            Impulses
          </button>
          <button
            className={activeTab === "members" ? "active" : ""}
            onClick={() => setActiveTab("members")}
          >
            Members ({members.length})
          </button>
          <button
            className={activeTab === "settings" ? "active" : ""}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
          <button
            className={activeTab === "governance" ? "active" : ""}
            onClick={() => setActiveTab("governance")}
          >
            Governance
          </button>
        </div>

        {/* ── IMPULSES TAB ── */}
        {activeTab === "impulses" && (
          <div className="impulses-tab-content">
            {/* Status filter */}
            <div className="impulse-filter-bar">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">All impulses</option>
                <option value="queued">Queued</option>
                <option value="voting">Voting</option>
                <option value="composing">Drafting</option>
                <option value="broadcast">Broadcast</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {/* Impulse creation form */}
            <ImpulseForm
              groupId={id}
              allGroups={allGroups}
              onCreated={load}
              disabled={isSabbatical}
            />

            {/* Impulse list */}
            {filteredImpulses.length === 0 ? (
              <div className="feed-empty">
                {filterStatus
                  ? `No impulses with status "${filterStatus}"`
                  : "No impulses yet. Create one above!"}
              </div>
            ) : (
              <div className="impulses-list">
                {filteredImpulses.map((imp) => (
                  <ImpulseCard
                    key={imp.id}
                    impulse={imp}
                    group={group}
                    members={members}
                    userId={userId}
                    tally={tallies[imp.id]}
                    timer={timers[imp.id]}
                    queuedPositions={queuedPositions}
                    totalQueued={impulses.filter((i) => i.status === "queued").length}
                    onVote={handleVote}
                    onRefresh={load}
                    onOpenComposer={setComposingImpulseId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MEMBERS TAB ── */}
        {activeTab === "members" && (
          <div className="members-tab-content">
            {/* Member search */}
            <div className="member-search">
              <input
                type="text"
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
            </div>

            <div className="member-count">
              {memberSearch
                ? `${filteredMembers.length} of ${members.length} members`
                : `${members.length} members`}
            </div>

            {filteredMembers.length === 0 ? (
              <div className="member-no-results">
                {memberSearch
                  ? `No members matching "${memberSearch}"`
                  : "No members"}
              </div>
            ) : (
              <div className="member-list">
                {[...filteredMembers]
                  .sort(
                    (a, b) =>
                      new Date(a.joinedAt).getTime() -
                      new Date(b.joinedAt).getTime()
                  )
                  .map((m) => {
                    const tenure = tenureDays(m.joinedAt);
                    const cohort = tenureCohort(tenure);
                    return (
                      <div key={m.id} className="member-row">
                        <div className="member-avatar">
                          {m.user.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="member-info">
                          <div className="member-name">
                            {m.user.username}
                            {m.isVouched && (
                              <span className="vouched-badge" title="Vouched member">
                                {" "}✓
                              </span>
                            )}
                          </div>
                          <div className="member-joined">
                            Joined{" "}
                            {new Date(m.joinedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="member-tenure">
                          <div
                            className="tenure-days"
                            style={{ color: cohort.color }}
                          >
                            {tenureLabel(tenure)}
                          </div>
                          <div className="tenure-label">{cohort.label}</div>
                          <div className="tenure-bar-wrap">
                            <div
                              className="tenure-bar-fill"
                              style={{
                                width: `${tenureBarWidth(tenure)}%`,
                                background: cohort.color,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {activeTab === "settings" && (
          <div className="settings-tab-content">
            <form onSubmit={handleSaveSettings}>
              {/* Bio */}
              <div className="settings-section">
                <h3>Group Bio</h3>
                <div className="settings-field">
                  <label htmlFor="settings-bio">Description</label>
                  <textarea
                    id="settings-bio"
                    value={settingsBio}
                    onChange={(e) => setSettingsBio(e.target.value)}
                    placeholder="Describe what this group is about"
                    maxLength={500}
                    rows={3}
                  />
                </div>
              </div>

              {/* Energy */}
              <div className="settings-section">
                <h3>Group Energy</h3>
                <div className="settings-field">
                  <label htmlFor="settings-energy">Energy type</label>
                  <select
                    id="settings-energy"
                    value={settingsEnergy}
                    onChange={(e) => setSettingsEnergy(e.target.value)}
                    disabled={cooldownHours > 0 && settingsEnergy !== group.energy}
                  >
                    {ENERGY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {cooldownHours > 0 && (
                  <div className="cooldown-notice">
                    🔄 Energy change available in {cooldownHours}h (72h cooldown)
                  </div>
                )}
              </div>

              {/* Timezone */}
              <div className="settings-section">
                <h3>Timezone</h3>
                <div className="settings-field">
                  <label htmlFor="settings-tz">Time zone</label>
                  <select
                    id="settings-tz"
                    value={settingsTz}
                    onChange={(e) => setSettingsTz(e.target.value)}
                  >
                    <option value="">None set</option>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Min Interaction Tier */}
              <div className="settings-section">
                <h3>Interaction Filter</h3>
                <div className="settings-field">
                  <label htmlFor="settings-tier">
                    Minimum tier to interact
                  </label>
                  <select
                    id="settings-tier"
                    value={settingsMinTier}
                    onChange={(e) => setSettingsMinTier(e.target.value)}
                  >
                    {TIER_ORDER.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cooldown-notice">
                  ℹ Groups below the minimum tier cannot send impulses here
                </div>
              </div>

              {/* Save */}
              <button type="submit" disabled={settingsSaving} style={{ width: "100%", marginBottom: 16 }}>
                {settingsSaving ? "Saving..." : "Save Settings"}
              </button>

              {settingsMessage && (
                <div className={settingsMessage.type === "saved" ? "settings-saved" : "settings-error"}>
                  {settingsMessage.text}
                </div>
              )}
            </form>

            {/* Leave group — danger zone */}
            <div className="settings-section leave-group-section">
              <h3>Leave Group</h3>
              <button className="danger-btn leave-group-btn" onClick={handleLeave}>
                Leave Group
              </button>
            </div>
          </div>
        )}

        {/* ── GOVERNANCE TAB ── */}
        {activeTab === "governance" && (
          <div className="governance-tab-content">
            {/* ── Vote-Kick ── */}
            <div className="governance-section">
              <h3>Vote-Kick</h3>
              <p className="governance-note">
                Propose to remove a member from this group. A majority vote (&gt;50% weighted by tenure) is required.
              </p>

              {activeKickVote ? (
                /* Active kick vote display */
                <div className="governance-card">
                  <div className="governance-card-info">
                    <div className="governance-card-title">
                      Kick vote — target: {activeKickVote.targetUser?.username ?? "Loading..."}
                    </div>
                    <div className="governance-card-desc">
                      Status: {activeKickVote.status}
                      {activeKickVote.tally && (
                        <> — Yes: {activeKickVote.tally.yesWeight}, No: {activeKickVote.tally.noWeight}</>
                      )}
                      {activeKickVote.reason && <> — Reason: {activeKickVote.reason}</>
                    }
                    </div>
                  </div>
                  {activeKickVote.status === "active" && (
                    <div className="governance-card-action" style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleVoteKick(activeKickVote.id, "yes")}>Yes</button>
                      <button onClick={() => handleVoteKick(activeKickVote.id, "no")}>No</button>
                      <button onClick={() => handleVoteKick(activeKickVote.id, "abstain")}>Abstain</button>
                    </div>
                  )}
                </div>
              ) : (
                /* Kick initiation form */
                <div className="governance-card">
                  <div className="governance-card-info" style={{ flex: 1 }}>
                    <select
                      value={kickTargetUserId}
                      onChange={(e) => setKickTargetUserId(e.target.value)}
                      style={{ marginBottom: 8 }}
                    >
                      <option value="">Select member to kick...</option>
                      {members
                        .filter((m) => m.userId !== userId)
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.user.username}
                          </option>
                        ))}
                    </select>
                    <input
                      value={kickReason}
                      onChange={(e) => setKickReason(e.target.value)}
                      placeholder="Reason (optional)"
                      maxLength={200}
                    />
                  </div>
                  <div className="governance-card-action">
                    <button
                      className="danger"
                      onClick={handleInitiateKick}
                      disabled={!kickTargetUserId || kickProcessing}
                    >
                      {kickProcessing ? "Initiating..." : "Initiate Kick"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Group Split ── */}
            <div className="governance-section">
              <h3>Group Split</h3>
              <p className="governance-note">
                Propose to split this group into two. Each member chooses which side to join.
              </p>

              {activeSplitVote ? (
                /* Active split vote display */
                <div className="governance-card">
                  <div className="governance-card-info">
                    <div className="governance-card-title">
                      Split vote — proposed group: "{activeSplitVote.newGroupName}"
                    </div>
                    <div className="governance-card-desc">
                      Status: {activeSplitVote.status}
                      {activeSplitVote.selectionsCount !== undefined && (
                        <> — {activeSplitVote.selectionsCount}/{activeSplitVote.memberCount} selected</>
                      )}
                      {activeSplitVote.stayingCount !== undefined && (
                        <> — Staying: {activeSplitVote.stayingCount}, Splintering: {activeSplitVote.splinteringCount}</>
                      )}
                    </div>
                  </div>
                  {activeSplitVote.status === "active" && (
                    <div className="governance-card-action" style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleSelectSplit(activeSplitVote.id, true)}>
                        Stay in "{group.name}"
                      </button>
                      <button className="warning-btn" onClick={() => handleSelectSplit(activeSplitVote.id, false)}>
                        Join "{activeSplitVote.newGroupName}"
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Split initiation form */
                <div className="governance-card">
                  <div className="governance-card-info" style={{ flex: 1 }}>
                    <input
                      value={splitNewName}
                      onChange={(e) => setSplitNewName(e.target.value)}
                      placeholder="Name for new splinter group"
                      maxLength={100}
                    />
                  </div>
                  <div className="governance-card-action">
                    <button
                      className="warning-btn"
                      onClick={handleInitiateSplit}
                      disabled={!splitNewName.trim() || splitProcessing}
                    >
                      {splitProcessing ? "Initiating..." : "Propose Split"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Group Merge ── */}
            <div className="governance-section">
              <h3>Group Merge</h3>
              <p className="governance-note">
                Propose to merge with another group. Members from both groups must approve. The target group's members move here on approval.
              </p>

              {activeMergeVote ? (
                /* Active merge vote */
                <div className="governance-card">
                  <div className="governance-card-info">
                    <div className="governance-card-title">
                      Merge vote: "{activeMergeVote.initiatedByGroup?.name ?? "..."}" ← "{activeMergeVote.targetGroup?.name ?? "..."}"
                    </div>
                    <div className="governance-card-desc">
                      Status: {activeMergeVote.status}
                      {activeMergeVote.initiatorApprovals && (
                        <> — Initiator approvals: {activeMergeVote.initiatorApprovals.filter(a => a.approved).length} yes / {activeMergeVote.initiatorApprovals.filter(a => !a.approved).length} no</>
                      )}
                      {activeMergeVote.targetApprovals && (
                        <> — Target approvals: {activeMergeVote.targetApprovals.filter(a => a.approved).length} yes / {activeMergeVote.targetApprovals.filter(a => !a.approved).length} no</>
                      )}
                    </div>
                  </div>
                  {activeMergeVote.status === "active" && (
                    <div className="governance-card-action" style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleApproveMerge(activeMergeVote.id, true)}>Approve</button>
                      <button className="danger" onClick={() => handleApproveMerge(activeMergeVote.id, false)}>Reject</button>
                    </div>
                  )}
                </div>
              ) : (
                /* Merge initiation form */
                <div className="governance-card">
                  <div className="governance-card-info" style={{ flex: 1 }}>
                    <select
                      value={mergeTargetId}
                      onChange={(e) => setMergeTargetId(e.target.value)}
                    >
                      <option value="">Select group to merge into this one...</option>
                      {allGroups
                        .filter((g) => g.id !== id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.tier}, {g.memberCount} members)
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="governance-card-action">
                    <button
                      onClick={handleInitiateMerge}
                      disabled={!mergeTargetId || mergeProcessing}
                    >
                      {mergeProcessing ? "Initiating..." : "Propose Merge"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Sabbatical ── */}
            <div className="governance-section">
              <h3>Sabbatical</h3>
              <p className="governance-note">
                Put the group into a quiet period (no new impulses can be created) or end an existing sabbatical early.
              </p>

              {activeSabbaticalVote ? (
                /* Active sabbatical vote */
                <div className="governance-card">
                  <div className="governance-card-info">
                    <div className="governance-card-title">
                      Sabbatical vote — {activeSabbaticalVote.direction === "enter" ? "Enter" : "Exit"} sabbatical
                      {activeSabbaticalVote.direction === "enter" && ` (${activeSabbaticalVote.durationHours}h)`}
                    </div>
                    <div className="governance-card-desc">
                      Status: {activeSabbaticalVote.status}
                      {activeSabbaticalVote.tally && (
                        <> — Yes: {activeSabbaticalVote.tally.yesWeight}, No: {activeSabbaticalVote.tally.noWeight}</>
                      )}
                    </div>
                  </div>
                  {activeSabbaticalVote.status === "active" && (
                    <div className="governance-card-action" style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleVoteSabbatical(activeSabbaticalVote.id, "yes")}>Yes</button>
                      <button onClick={() => handleVoteSabbatical(activeSabbaticalVote.id, "no")}>No</button>
                      <button onClick={() => handleVoteSabbatical(activeSabbaticalVote.id, "abstain")}>Abstain</button>
                    </div>
                  )}
                </div>
              ) : (
                /* Sabbatical actions */
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="governance-card">
                    <div className="governance-card-info">
                      <div className="governance-card-title">
                        {isSabbatical ? "🛌 Currently on sabbatical" : "Start sabbatical"}
                      </div>
                      <div className="governance-card-desc">
                        {isSabbatical
                          ? `Until ${new Date(group.sabbaticalUntil!).toLocaleDateString()}`
                          : "Pause new impulses for a period"}
                      </div>
                    </div>
                    <div className="governance-card-action" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {!isSabbatical && (
                        <>
                          <select
                            value={sabbDuration}
                            onChange={(e) => setSabbDuration(Number(e.target.value))}
                            style={{ width: 80 }}
                          >
                            <option value={24}>24h</option>
                            <option value={48}>48h</option>
                            <option value={72}>72h</option>
                            <option value={168}>7d</option>
                          </select>
                          <button
                            onClick={() => handleInitiateSabbatical("enter")}
                            disabled={sabbProcessing}
                          >
                            {sabbProcessing ? "..." : "Enter"}
                          </button>
                        </>
                      )}
                      {isSabbatical && (
                        <button
                          className="warning-btn"
                          onClick={() => handleInitiateSabbatical("exit")}
                          disabled={sabbProcessing}
                        >
                          {sabbProcessing ? "..." : "Exit Early"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer modal overlay */}
      {composerImpulse && userId && (
        <ComposerModal
          impulse={composerImpulse}
          groupName={group.name}
          currentUserId={userId}
          onClose={() => setComposingImpulseId(null)}
          onTransition={() => { setComposingImpulseId(null); load(); }}
        />
      )}
    </AppShell>
  );
}

