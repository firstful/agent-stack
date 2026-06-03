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

  // Feed (cursor-based pagination)
  feed: (
    minTier?: string,
    sort?: string,
    cursor?: string
  ) => {
    const params = new URLSearchParams();
    if (minTier) params.set("minTier", minTier);
    if (sort && sort !== "newest") params.set("sort", sort);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    return fetchApi<{ messages: any[]; nextCursor: string | null }>(
      `/api/feed${qs ? `?${qs}` : ""}`
    );
  },

  // Groups
  groups: () => fetchApi<any[]>("/api/groups"),
  createGroup: (data: {
    name: string;
    bio?: string;
    energy?: string;
    timezone?: string;
  }) =>
    fetchApi<any>("/api/groups", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  group: (id: string) => fetchApi<any>(`/api/groups/${id}`),
  groupMembers: (id: string) => fetchApi<any[]>(`/api/groups/${id}/members`),
  groupBlocks: (id: string) => fetchApi<any[]>(`/api/groups/${id}/blocks`),
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
  createImpulse: (
    groupId: string,
    data: {
      title: string;
      description?: string;
      targetGroupId?: string;
      targetPostId?: string;
    }
  ) =>
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

  // Tally (weighted vote tally by tenure cohort)
  tally: (impulseId: string) =>
    fetchApi<{
      cohorts: Array<{
        range: string;
        minDays: number;
        maxDays: number;
        yesWeight: number;
        noWeight: number;
        voterCount: number;
      }>;
      totals: { yesWeight: number; noWeight: number; totalVoters: number };
    }>(`/api/impulses/${impulseId}/tally`),

  // Drafts
  drafts: (impulseId: string) =>
    fetchApi<any[]>(`/api/impulses/${impulseId}/drafts`),
  sendDraft: (data: {
    impulseId: string;
    content: string;
    parentDraftId?: string;
  }) =>
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
  endorseMessage: (id: string) =>
    fetchApi<{ ok: boolean; endorsements: number }>(
      `/api/messages/${id}/endorse`,
      { method: "POST" }
    ),

  // Settings
  updateMe: (data: { username?: string }) =>
    fetchApi<any>("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Admin — Banned Words
  bannedWords: () => fetchApi<any[]>("/api/admin/banned-words"),
  addBannedWord: (word: string) =>
    fetchApi<any>("/api/admin/banned-words", {
      method: "POST",
      body: JSON.stringify({ word }),
    }),
  deleteBannedWord: (id: string) =>
    fetchApi<any>(`/api/admin/banned-words/${id}`, {
      method: "DELETE",
    }),

  // Admin — Fraud Audit Log
  fraudAuditLog: (cursor?: string, action?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (action) params.set("action", action);
    const qs = params.toString();
    return fetchApi<{ entries: any[]; nextCursor: string | null }>(
      `/api/admin/fraud-audit-log${qs ? `?${qs}` : ""}`
    );
  },

  // Settings — Update group (bio, energy, timezone, minInteractionTier)
  updateGroupSettings: (groupId: string, data: {
    bio?: string;
    energy?: string;
    timezone?: string;
    minInteractionTier?: string;
  }) =>
    fetchApi<any>(`/api/groups/${groupId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Governance — Vote-Kick
  initiateKick: (groupId: string, targetUserId: string, reason?: string) =>
    fetchApi<any>(`/api/groups/${groupId}/kick`, {
      method: "POST",
      body: JSON.stringify({ targetUserId, reason }),
    }),
  voteOnKick: (kickVoteId: string, vote: "yes" | "no" | "abstain") =>
    fetchApi<any>(`/api/kick-votes/${kickVoteId}/vote`, {
      method: "POST",
      body: JSON.stringify({ vote }),
    }),
  getKickVote: (kickVoteId: string) =>
    fetchApi<any>(`/api/kick-votes/${kickVoteId}`),

  // Governance — Group Split
  initiateSplit: (groupId: string, newGroupName: string) =>
    fetchApi<any>(`/api/groups/${groupId}/split`, {
      method: "POST",
      body: JSON.stringify({ newGroupName }),
    }),
  selectSplit: (splitVoteId: string, chooseOriginal: boolean) =>
    fetchApi<any>(`/api/split-votes/${splitVoteId}/select`, {
      method: "POST",
      body: JSON.stringify({ chooseOriginal }),
    }),
  getSplitVote: (splitVoteId: string) =>
    fetchApi<any>(`/api/split-votes/${splitVoteId}`),

  // Governance — Group Merge
  initiateMerge: (groupId: string, targetGroupId: string) =>
    fetchApi<any>(`/api/groups/${groupId}/merge`, {
      method: "POST",
      body: JSON.stringify({ targetGroupId }),
    }),
  approveMerge: (mergeVoteId: string, approved: boolean) =>
    fetchApi<any>(`/api/merge-votes/${mergeVoteId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
  getMergeVote: (mergeVoteId: string) =>
    fetchApi<any>(`/api/merge-votes/${mergeVoteId}`),

  // Governance — Sabbatical
  initiateSabbatical: (groupId: string, direction: "enter" | "exit", durationHours?: number) =>
    fetchApi<any>(`/api/groups/${groupId}/sabbatical`, {
      method: "POST",
      body: JSON.stringify({ direction, durationHours }),
    }),
  voteOnSabbatical: (sabbaticalVoteId: string, vote: "yes" | "no" | "abstain") =>
    fetchApi<any>(`/api/sabbatical-votes/${sabbaticalVoteId}/vote`, {
      method: "POST",
      body: JSON.stringify({ vote }),
    }),
  getSabbaticalVote: (sabbaticalVoteId: string) =>
    fetchApi<any>(`/api/sabbatical-votes/${sabbaticalVoteId}`),

  // Search
  search: (q: string) =>
    fetchApi<any>(`/api/search?q=${encodeURIComponent(q)}`),
};
