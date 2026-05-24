"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function CreateGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [energy, setEnergy] = useState("thoughtful");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const group = await api.createGroup({ name, bio, energy });
      router.push(`/groups/${group.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-view">
      <h1>Create Group</h1>
      <p className="form-note">Groups start as fringe (invite-only) until 5 members join.</p>
      <form onSubmit={handleSubmit} className="standard-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} />
        </label>
        <label>
          Energy
          <select value={energy} onChange={(e) => setEnergy(e.target.value)}>
            <option value="thoughtful">Thoughtful</option>
            <option value="snarky">Snarky</option>
            <option value="funny">Funny</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Group"}
        </button>
      </form>
    </div>
  );
}
