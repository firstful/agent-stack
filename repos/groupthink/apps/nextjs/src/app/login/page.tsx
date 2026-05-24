"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [provider, setProvider] = useState("google");
  const [providerId, setProviderId] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await api.register({ provider, providerId, username });
      localStorage.setItem("gt-user-id", user.id);
      router.push("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-view">
      <h1>Sign In</h1>
      <p className="form-note">
        OAuth-only authentication. Enter your provider ID to register or sign in.
      </p>
      <form onSubmit={handleSubmit} className="standard-form">
        <label>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="google">Google</option>
            <option value="github">GitHub</option>
            <option value="apple">Apple</option>
          </select>
        </label>
        <label>
          Provider ID
          <input
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            required
            placeholder="OAuth provider user ID"
          />
        </label>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={2}
            maxLength={30}
            placeholder="Choose a username"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
