# Multi-Server Support Migration Plan

## Goal

Allow OpenChamber to connect to and switch between multiple OpenCode servers within a single session. Each server is an independent backend (different host, port, or kilocode/opencode variant). Sessions, projects, and sync state are scoped per server.

## Current state

- `packages/ui/src/lib/opencode/client.ts` exports a module-level singleton `opencodeClient` built from `VITE_OPENCODE_URL || "/api"`.
- `sync-context.tsx` holds a `SyncContext` with an `sdk` field — already the right shape, but it's populated once at mount from the singleton and never changes.
- All stores (`useProjectsStore`, `useGlobalSessionsStore`, `contextStore`, etc.) import `opencodeClient` directly and assume one server for the page lifetime.
- The web server proxy (`packages/web/server/index.js`) routes `/api/*` to a single upstream.

## What does not need to change

- The sync engine (`event-pipeline`, `event-reducer`, `bootstrap`, `materialization`) — it is stateless relative to server identity; it operates on whatever `sdk` it receives.
- The SSE/WebSocket reconnect loop — already parameterized by the pipeline's abort signal.
- All UI components — they read from stores, not from the client directly.

---

## Phase 1 — Server registry (no UI change, no behavior change)

**Goal:** introduce the data model without breaking anything.

### 1a. Define `ServerEntry` type

Add `packages/ui/src/lib/opencode/servers.ts`:

```ts
export type ServerEntry = {
  id: string;          // stable opaque ID, e.g. "srv_<random>"
  label: string;       // display name
  baseUrl: string;     // e.g. "http://host:4096" or "/api"
  addedAt: number;     // Date.now()
};
```

### 1b. Create `useServersStore`

`packages/ui/src/stores/useServersStore.ts` — mirrors the shape of `useProjectsStore`:

- `servers: ServerEntry[]`
- `activeServerId: string | null`
- `addServer(baseUrl, label?) → ServerEntry`
- `removeServer(id)`
- `setActiveServer(id)`

Persist to `localStorage` (same pattern as `useProjectsStore`). On first load, seed with one entry derived from `VITE_OPENCODE_URL || "/api"` so existing deployments are unaffected.

### 1c. Create `createClientForServer(entry: ServerEntry): OpencodeClient`

Extract the client construction logic from `client.ts` into a factory. The existing `opencodeClient` export becomes `createClientForServer({ baseUrl: DEFAULT_BASE_URL, ... })` — no call-site changes yet.

**Verification:** `bun run type-check && bun run lint` passes. No behavior change.

---

## Phase 2 — Make `SyncContext` server-aware

**Goal:** the sync tree can be rooted at any server, not just the default one.

### 2a. Thread `OpencodeClient` through `SyncContext`

`sync-context.tsx` already has:
```ts
type SyncSystem = { childStores: ChildStoreManager; sdk: OpencodeClient; directory: string }
```

Change the `SyncProvider` to accept an explicit `client` prop (falls back to the singleton for now). Internally, replace all `opencodeClient` imports in `sync-context.tsx` with the prop value.

### 2b. Namespace session IDs

Sessions from different servers can collide on ID. Key all child stores and caches as `${serverId}:${sessionId}` internally. The sync engine already passes IDs through opaquely — this is a store-layer concern only.

Affected stores: `useGlobalSessionsStore`, `contextStore`, `useSessionPinnedStore`, `useSessionFoldersStore`.

### 2c. Scope `useProjectsStore` per server

Projects are per-server (a project path on server A is unrelated to the same path on server B). Add `serverId` to `ProjectEntry` and filter by `activeServerId` in all selectors.

**Verification:** existing single-server behavior unchanged. `bun run type-check && bun run lint` passes.

---

## Phase 3 — Web server proxy: multi-upstream routing

**Goal:** the Node proxy can forward to multiple opencode backends.

### 3a. Add `/api/servers/:serverId/*` proxy routes

In `packages/web/server/index.js`, alongside the existing `/api` proxy, add a parameterized route:

```
/api/servers/:serverId/* → forward to the URL registered for serverId
```

Server registry is passed in at startup (from env or a config file). The existing `/api` route stays as-is for the default server.

### 3b. SSE fan-out

The event stream hub (`createGlobalMessageStreamHub`) currently fans out one upstream SSE. Extend it to maintain one SSE connection per registered server, tagged by `serverId`. Clients subscribe to `serverId`-scoped streams.

**Verification:** existing `/api` proxy unaffected. New routes return 404 until a server is registered.

---

## Phase 4 — Server switcher UI

**Goal:** users can add, remove, and switch servers.

### 4a. Server list in Settings

Add a "Servers" section to `SettingsView` (follow the pattern of the existing sections in `packages/ui/src/components/sections/`). Fields: URL, label, add/remove. Validate the URL by hitting `GET <url>/v2/app` before saving.

### 4b. Active server indicator

Add a server badge to the sidebar header (near the project picker). Clicking opens the server switcher. When switching:

1. Abort the current sync pipeline (existing abort signal mechanism).
2. Set `activeServerId` in `useServersStore`.
3. Re-mount `SyncProvider` with the new client — React key trick on the provider is sufficient.

### 4c. Per-server session list

The session list already reads from `useGlobalSessionsStore`. With phase 2 namespacing in place, filtering by `activeServerId` is the only change needed here.

---

## Phase 5 — VS Code and Electron parity

- **Electron:** `main.mjs` boots one opencode server in-process. Multi-server in desktop means connecting to additional *remote* servers (the local one is always server 0). The `startWebUiServer` call passes the local server URL; additional servers are added via the UI and proxied through the web server layer (phase 3).
- **VS Code:** `packages/vscode/src/opencode.ts` manages the opencode process. Same pattern — local process is server 0, remote servers added via UI. The VS Code SSE proxy (`sseProxy.ts`) needs the same parameterized routing as phase 3a.

---

## Risk areas

| Area | Risk | Mitigation |
|---|---|---|
| Session ID collisions | Medium — stores keyed by bare session ID today | Phase 2b namespacing; do this before any multi-server state can accumulate |
| Reconnect loop targeting wrong server | Low — loop uses the client it was given | Phase 2a ensures each sync tree has its own client |
| Auth tokens per server | Medium — `ui-auth` and `tunnel-auth` are currently global | Each server entry needs its own auth token; extend `ServerEntry` with `authToken?: string` and thread it through the proxy headers |
| CORS on direct client connections | High if bypassing the proxy | Always route through the Node proxy (phase 3); never let the browser hit opencode directly |

---

## Sequence summary

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5
data model   sync scope   proxy        UI          parity
(no UI)      (no UI)      routing      switcher    (VS Code/Electron)
```

Each phase is independently shippable and leaves the product in a working state. Phases 1–2 are internal refactors with no visible behavior change. Phase 3 is backend-only. Phase 4 is the first user-visible change.
