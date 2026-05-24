"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api.join(code);
      router.push(`/groups/${result.groupId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-view">
      <h1>Join Group</h1>
      <p className="form-note">Enter an invite code to join a group.</p>
      <form onSubmit={handleSubmit} className="standard-form">
        <label>
          Invite Code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="e.g. a1b2c3d4"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Joining..." : "Join Group"}
        </button>
      </form>
    </div>
  );
}
