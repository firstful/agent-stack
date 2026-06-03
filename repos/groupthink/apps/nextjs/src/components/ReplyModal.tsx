"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

type Message = {
  id: string;
  content: string;
  status: "active" | "revoked";
  createdAt: string;
  group: { id: string; name: string; bio: string; energy: string };
  targetGroup?: { id: string; name: string; energy?: string };
  endorsements: number;
  nickname: string | null;
  parentPost: { id: string; content: string; group: { id: string; name: string } } | null;
};

type Group = {
  id: string;
  name: string;
  bio?: string;
  energy?: string;
};

type ReplyModalProps = {
  targetPost: Message;
  onClose: () => void;
  onCreated: () => void;
};

export function ReplyModal({ targetPost, onClose, onCreated }: ReplyModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.groups().then((res: Group[]) => {
      setGroups(res);
      if (res.length > 0 && !selectedGroup) {
        setSelectedGroup(res[0].id);
      }
    }).catch(() => {});
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Please enter a title for your impulse.");
      return;
    }
    if (!selectedGroup) {
      setError("Please select a group to reply from.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await api.createImpulse(selectedGroup, {
        title: title.trim(),
        description: description.trim() || undefined,
        targetPostId: targetPost.id,
      });
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create impulse. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="reply-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="reply-modal">
        <div className="reply-modal-header">
          <h2>Reply to Post</h2>
          <button className="reply-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Target post preview */}
        <div className="reply-target-preview">
          <div className="reply-target-group">{targetPost.group.name}</div>
          <p className="reply-target-content">{targetPost.content}</p>
        </div>

        {error && <div className="reply-modal-error">{error}</div>}

        <div className="reply-modal-body">
          {/* Group selector */}
          <div className="reply-field">
            <label htmlFor="reply-group">Reply as group</label>
            <select
              id="reply-group"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
            >
              {groups.length === 0 && <option value="">No groups available</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Impulse title */}
          <div className="reply-field">
            <label htmlFor="reply-title">Impulse title <span className="required">*</span></label>
            <input
              id="reply-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What does your group want to say?"
              maxLength={200}
              autoFocus
            />
          </div>

          {/* Optional description */}
          <div className="reply-field">
            <label htmlFor="reply-desc">Details (optional)</label>
            <textarea
              id="reply-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context for the group's deliberation..."
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>

        <div className="reply-modal-actions">
          <button className="reply-btn-cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="reply-btn-submit"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !selectedGroup}
          >
            {submitting ? "Creating impulse…" : "Create Impulse"}
          </button>
        </div>

        <div className="reply-modal-note">
          This will create an impulse for your group to deliberate. Once approved,
          the response will be broadcast as a message targeting this post.
        </div>
      </div>
    </div>
  );
}
