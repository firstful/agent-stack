"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { Group } from "./group-detail-types";

interface ImpulseFormProps {
  groupId: string;
  allGroups: Group[];
  onCreated: () => void;
  disabled?: boolean;
}

export function ImpulseForm({ groupId, allGroups, onCreated, disabled }: ImpulseFormProps) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const filteredGroups = useMemo(() => {
    const others = allGroups.filter((g) => g.id !== groupId);
    if (!searchQuery.trim()) return others;
    const q = searchQuery.toLowerCase();
    return others.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.tier.includes(q)
    );
  }, [allGroups, groupId, searchQuery]);

  const selectedTarget = useMemo(
    () => allGroups.find((g) => g.id === targetGroupId),
    [allGroups, targetGroupId]
  );

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
      const userId = localStorage.getItem("gt-user-id");
      const payload: Record<string, unknown> = { title: title.trim() };
      if (desc.trim()) payload.description = desc.trim();
      if (targetGroupId) payload.targetGroupId = targetGroupId;

      const res = await fetch(`${BASE_URL}/api/groups/${groupId}/impulses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userId ? { "x-user-id": userId } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Error ${res.status}`);
      }

      setTitle("");
      setDesc("");
      setTargetGroupId("");
      setSearchQuery("");
      setShowSearch(false);
      await onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create impulse");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="impulse-form" onSubmit={handleSubmit}>
      {/* Title */}
      <div className="impulse-form-field">
        <label className="impulse-form-label" htmlFor="imp-title">
          Title <span className="impulse-form-required">*</span>
        </label>
        <input
          id="imp-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What action should the group take?"
          maxLength={200}
          required
          autoFocus
          disabled={disabled || loading}
        />
        <span className="impulse-form-char-count">{title.length}/200</span>
      </div>

      {/* Description */}
      <div className="impulse-form-field">
        <label className="impulse-form-label" htmlFor="imp-desc">
          Description
        </label>
        <textarea
          id="imp-desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Additional context (optional)"
          maxLength={2000}
          rows={3}
          disabled={disabled || loading}
        />
        <span className="impulse-form-char-count">{desc.length}/2000</span>
      </div>

      {/* Target group selector */}
      <div className="impulse-form-field">
        <label className="impulse-form-label">Target Group</label>

        {selectedTarget ? (
          <div className="impulse-form-target-selected">
            <div className="impulse-form-target-info">
              <span className="impulse-form-target-name">
                → {selectedTarget.name}
              </span>
              <span className="tier-badge tier-badge--sm">{selectedTarget.tier}</span>
              <span className="impulse-form-target-members">
                {selectedTarget.memberCount} members
              </span>
            </div>
            <button
              type="button"
              className="impulse-form-target-remove"
              onClick={() => {
                setTargetGroupId("");
                setSearchQuery("");
              }}
              disabled={loading}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="impulse-form-search-wrap" ref={searchRef}>
            <div className="impulse-form-search-input-wrap">
              <span className="impulse-form-search-icon">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearch(true);
                }}
                onFocus={() => setShowSearch(true)}
                placeholder="Search groups to target (or leave empty for internal impulse)..."
                disabled={disabled || loading}
                className="impulse-form-search-input"
              />
            </div>
            {showSearch && (
              <div className="impulse-form-search-dropdown">
                <button
                  type="button"
                  className={`impulse-form-search-option ${!searchQuery && !targetGroupId ? "impulse-form-search-option--active" : ""}`}
                  onClick={() => {
                    setTargetGroupId("");
                    setShowSearch(false);
                    setSearchQuery("");
                  }}
                >
                  <span className="impulse-form-option-icon">🏠</span>
                  <span className="impulse-form-option-text">No target (internal impulse)</span>
                </button>
                {filteredGroups.length === 0 ? (
                  <div className="impulse-form-search-empty">
                    {searchQuery ? `No groups matching "${searchQuery}"` : "No other groups available"}
                  </div>
                ) : (
                  filteredGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`impulse-form-search-option ${targetGroupId === g.id ? "impulse-form-search-option--active" : ""}`}
                      onClick={() => {
                        setTargetGroupId(g.id);
                        setShowSearch(false);
                        setSearchQuery("");
                      }}
                    >
                      <span className="impulse-form-option-icon">→</span>
                      <span className="impulse-form-option-text">{g.name}</span>
                      <span className="tier-badge tier-badge--sm">{g.tier}</span>
                      <span className="impulse-form-option-members">{g.memberCount}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <span className="impulse-form-hint">
          Leave empty for an impulse internal to this group
        </span>
      </div>

      {/* Error */}
      {error && <p className="form-error">{error}</p>}

      {/* Submit */}
      <button type="submit" disabled={loading || disabled} className="impulse-form-submit">
        {loading ? "Creating..." : disabled ? "Sabbatical — impulse creation paused" : "Create Impulse"}
      </button>
    </form>
  );
}
