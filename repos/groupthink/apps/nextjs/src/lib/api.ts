const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gt-user-id");
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const userId = getUserId();
  if (userId) headers["x-user-id"] = userId;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  // Auth
  register: (data: { provider: string; providerId: string; username: string }) =>
    fetchApi<any>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  me: () => fetchApi<any>("/api/auth/me"),

  // Feed
  feed: (minTier?: string) =>
    fetchApi<any[]>(`/api/feed${minTier ? `?minTier=${minTier}` : ""}`),

  // Groups
  groups: () => fetchApi<any[]>("/api/groups"),
  createGroup: (data: { name: string; bio?: string; energy?: string; timezone?: string }) =>
    fetchApi<any>("/api/groups", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  group: (id: string) => fetchApi<any>(`/api/groups/${id}`),
  groupMembers: (id: string) => fetchApi<any[]>(`/api/groups/${id}/members`),
  inviteCodes: (groupId: string) =>
    fetchApi<any[]>(`/api/groups/${groupId}/invite-codes`),
  generateInviteCode: (groupId: string) =>
    fetchApi<any[]>(`/api/groups/${groupId}/invite-codes`, {
      method: "POST",
    }),

  // Join
  join: (code: string) =>
    fetchApi<any>("/api/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  // Impulses
  impulses: (groupId: string, status?: string) =>
    fetchApi<any[]>(
      `/api/groups/${groupId}/impulses${status ? `?status=${status}` : ""}`
    ),
  impulse: (id: string) => fetchApi<any>(`/api/impulses/${id}`),
  createImpulse: (groupId: string, data: { title: string; description?: string; targetGroupId?: string }) =>
    fetchApi<any>(`/api/groups/${groupId}/impulses`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Voting
  vote: (data: { impulseId: string; vote: "yes" | "no" | "abstain" }) =>
    fetchApi<any>(`/api/impulses/${data.impulseId}/vote`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Drafts
  drafts: (impulseId: string) =>
    fetchApi<any[]>(`/api/impulses/${impulseId}/drafts`),
  sendDraft: (data: { impulseId: string; content: string; parentDraftId?: string }) =>
    fetchApi<any>(`/api/impulses/${data.impulseId}/draft`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Summaries
  summaries: (impulseId: string) =>
    fetchApi<any[]>(`/api/impulses/${impulseId}/summaries`),

  // Messages
  message: (id: string) => fetchApi<any>(`/api/messages/${id}`),
  revokeMessage: (id: string) =>
    fetchApi<any>(`/api/messages/${id}/revoke`, { method: "POST" }),

  // Search
  search: (q: string) =>
    fetchApi<any>(`/api/search?q=${encodeURIComponent(q)}`),
};
