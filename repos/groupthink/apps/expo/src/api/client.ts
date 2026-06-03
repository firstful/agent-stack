/**
 * API client for the Groupthink Expo app.
 *
 * Thin wrapper around fetch that injects the x-user-id header
 * required by all authenticated backend endpoints.
 *
 * Screens obtain the userId from `useAuth()` and call the
 * appropriate helper directly.
 */

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// ── Helpers ──

function headers(userId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (userId) h["x-user-id"] = userId;
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ──

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/** GET request with optional x-user-id. */
export function apiGet<T = unknown>(
  path: string,
  userId?: string,
): Promise<T> {
  return fetch(apiUrl(path), { headers: headers(userId) }).then(handleResponse<T>);
}

/** POST request with JSON body. */
export function apiPost<T = unknown>(
  path: string,
  body: unknown,
  userId?: string,
): Promise<T> {
  return fetch(apiUrl(path), {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(body),
  }).then(handleResponse<T>);
}

/** DELETE request. */
export function apiDelete<T = unknown>(
  path: string,
  userId?: string,
): Promise<T> {
  return fetch(apiUrl(path), {
    method: "DELETE",
    headers: headers(userId),
  }).then(handleResponse<T>);
}
