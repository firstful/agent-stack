"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type User = {
  id: string;
  username: string;
  oauthProvider: string;
  createdAt: string;
  lastLoginAt: string;
};

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch(`/api/auth/me`, {
      headers: { "x-user-id": id },
    })
      .then((r) => r.json())
      .then(setUser)
      .catch(() => {});
  }, [id]);

  if (!user) return <div className="feed-view">Loading...</div>;

  return (
    <div className="feed-view">
      <h1>{user.username}</h1>
      <div className="meta">
        <p>Provider: {user.oauthProvider}</p>
        <p>Joined: {new Date(user.createdAt).toLocaleDateString()}</p>
        <p>Last login: {new Date(user.lastLoginAt).toLocaleString()}</p>
      </div>
    </div>
  );
}
