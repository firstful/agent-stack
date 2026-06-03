# Groupthink — Backlog

## Overview

Collaboration platform for impulse-driven group composition with adaptive voting, LLM summarization, and real-time feedback. Next.js + Hono API + Postgres/Redis. Significant gap between spec and implementation — core infrastructure runs but most business logic is unimplemented.

## Status

- **Completion**: ~126/205 deliverables done (~61%)
- **Phase/Stage**: Alpha — core impulse loop automated, group management (create, join, leave, settings, nicknames), voting (cast + tenure-weighted tally), endorsements with rate limiting, search, auth scaffold. Composer modal with full-screen overlay, threaded drafts, adaptive timer, lock transition, LLM summary voting, and broadcast confirmation. Structured logging, health checks, Postgres backup, and rollback procedures deployed. Mobile: search, bottom tab nav, stack navigation, deep linking. Push notifications via Expo with in-app notification center. Mobile web (mdot): single-column layout with bottom tab nav, feed, search, groups, notifications center, profile.
- **Last updated**: 2026-06-02

## Deliverables

### 1. Infrastructure (8/10 complete)
- [x] Postgres sidecar container (agent-stack.json)
- [x] Redis sidecar container
- [x] Service discovery env vars (DATABASE_URL, REDIS_URL)
- [x] Persistent volume for Postgres
- [x] Production Dockerfile (multi-stage, pnpm)
- [x] pnpm-workspace.yaml, removed package-lock.json
- [x] Agent-stack.json with both sidecars wired
- [x] Run initial Drizzle migration on container start (via entrypoint.sh)
- [ ] Verify reconciliation loop picks up all three containers
- [ ] Fix port 3000 conflict — `auto_port: true` needed in agent-stack.json (opencode systemd service occupies port 3000)

### 2. Database — Schema (1/9 complete)
- [ ] Add all missing indexes (search, feed ordering, impulse lookups, vote aggregation)
- [ ] Add composite indexes (group_id + status on impulses, group_id + joined_at on memberships)
- [x] Add `invite_codes` table (code, group_id, created_by, used_by, used_at, expires_at)
- [ ] Add `vouch_requests` table
- [ ] Add `rate_limits` table
- [ ] Add `energy_history` table
- [ ] Add `group_blocks` table
- [ ] Add `banned_words` table
- [ ] Create seed migration with demo groups, users, sample impulses

### 3. Backend API — Authentication (1/6 complete)
- [x] OAuth register/login endpoint (`POST /api/auth/register`, `GET /api/auth/me`)
- [ ] OAuth callback handlers for Google, GitHub, Apple
- [ ] Session management (JWT or cookie-based)
- [ ] Cloudflare Turnstile verification on sign-up
- [ ] Auth middleware (populates `x-user-id` from session)
- [ ] Onboarding flow (username selection after first OAuth)

### 3.2 Groups (7/8 done)
- [x] Create group endpoint (hidden fringe group, 5 invite codes)
- [x] Invite code generation endpoint (max 5 unused codes)
- [x] Join group via invite code
- [x] Leave group endpoint (prevents last-member orphan)
- [x] Update group settings (bio, timezone, energy with 72hr cooldown)
- [x] Nickname CRUD endpoints (set/update via POST, list via GET, delete via DELETE)
- [ ] Block/unblock group endpoints
- [x] Group creation starts as fringe, auto-promotes via member count
- [ ] Tier-based interaction filter on incoming impulses

|### 3.3 Impulse Lifecycle (12/16 complete)
|- [x] Implement state machine: queued → voting → composing → summarizing → approval → broadcast
|- [x] Auto-advance queued → voting when tenure-weighted queue position reaches top
|- [x] Adaptive voting timer (start at 4h, shrink by velocity/consensus, collapse on supermajority)
|- [x] Tenure-weighted vote recording endpoint
|- [x] Auto-advance voting → composing when threshold met
|- [x] Composer lock logic (adaptive timer or manual lock)
|- [x] LLM summary generation trigger on lock
|- [x] Summary approval phase with voting
|- [x] Broadcast handler (public message or discard)
|- [x] Impulse expiry handler (stale queue >7d, voting failure, no composing activity)
|- [x] Lifecycle engine (8s poll, all phases driven automatically)
|- [x] Recalculates tenure-weighted queue after each advancement

### 3.4 Composer / Drafts (0/3 complete)
- [ ] Draft submission endpoint (with parent_draft_id for threading)
- [ ] Draft retrieval (ordered by thread ancestry)
- [ ] Real-time draft push (SSE or WebSocket)

### 3.5 Messages / Feed (5/5 complete)
- [x] Feed endpoint with cursor-based pagination
- [x] Tier filter on feed
- [x] Single message endpoint
- [x] Revocation endpoint (24h window, supermajority)
- [x] Retweet/endorsement endpoint (with global rate limit via Redis, max 10/day)

### 3.6 Voting (2/4 complete)
- [x] Vote casting (upsert: update or insert)
- [x] Vote tally endpoint (weighted totals by tenure cohort: <30d, 30–89d, 90–364d, 365d+)
- [ ] Adaptive timer recalculation on each vote
- [ ] Vote suppression for flagged accounts

### 3.7 Search (2/3 complete)
- [ ] Full-text search on public messages (Postgres tsvector)
- [x] Group name/bio search
- [x] Intra-group search endpoint (requires membership)

### 3.8 Direct Messages (3/3 complete)
- [x] Send DM endpoint (`POST /api/dms` — validates group membership, sender ≠ recipient)
- [x] List DMs for a user (inbox) (`GET /api/dms` — deduplicated conversations, latest first)
- [x] Thread view for DM conversation (`GET /api/dms/:id` — all messages between same user pair in same group)

### 3.9 Governance (4/4 complete)
- [x] Vote-kick endpoint (initiate: `POST /api/groups/:id/kick`, vote: `POST /api/kick-votes/:id/vote`, execute: automatic on >50% majority, view: `GET /api/kick-votes/:id`)
- [x] Group split endpoint (initiate: `POST /api/groups/:id/split`, member-side selection: `POST /api/split-votes/:id/select`, execute: automatic when all members have chosen, view: `GET /api/split-votes/:id`)
- [x] Group merge endpoint (initiate: `POST /api/groups/:id/merge`, mutual vote: `POST /api/merge-votes/:id/approve`, execute: automatic when both groups approve, view: `GET /api/merge-votes/:id`)
- [x] Sabbatical vote endpoint (initiate enter/exit: `POST /api/groups/:id/sabbatical`, vote: `POST /api/sabbatical-votes/:id/vote`, execute: automatic on >50% majority, view: `GET /api/sabbatical-votes/:id`)

### 3.10 Fraud Detection (6/7 complete)
- [x] Cohort analysis — flag accounts from same creation window
- [x] Cross-group observation — identical join/vote patterns
- [x] Activity gate — voting weight modifier based on non-voting engagement
- [x] Vouch system — accelerate weight for vouched accounts
- [x] Behavioral heuristics — same-vote blocs, timing
- [x] Shadow-ban endpoint
- [ ] Audit log for fraud flags

### 3.11 Content Moderation (3/3 complete)
- [x] Banned words check on broadcast
- [x] LLM system prompt injection with content rules
- [x] Report endpoint for public messages

### 3.12 Scheduled Jobs (4/4 complete)
- [x] Reputation decay job (daily — halves every 60 days inactive)
- [x] Impulse expiry job (minute — safety net for stalled impulses)
- [x] Sabbatical expiry job (hourly — clears expired sabbaticals)
- [x] Invite code cleanup job (daily — removes expired unused codes)

### 4. Desktop Web — Auth (0/5 complete)
- [ ] OAuth login buttons (Google, GitHub, Apple)
- [ ] Turnstile widget on sign-up
- [ ] Auth callback pages
- [ ] Session persistence
- [ ] Auth middleware redirects

### 4.2 Layout (4/4 complete)
- [x] Three-panel shell scaffold (nav, main, detail)
- [x] Responsive breakpoint (collapses right sidebar)
- [x] Loading skeletons for all panels
- [x] Error boundaries per panel

### 4.3 Home Feed (3/8 complete)
- [x] Real feed from API
- [x] Tier filter dropdown
- [ ] Sort toggle (newest, popular)
- [ ] Infinite scroll pagination
- [ ] Reply button → creates impulse
- [ ] Endorse button with count
- [ ] Revocation banner styling
- [ ] Energy badge display
- [ ] Nickname display
- [ ] Thread indicator

### 4.4 Group Detail (10/14 complete)
- [x] Real impulses from API
- [x] Impulse creation form (inline)
- [x] Invite codes display
- [x] Tier and energy badges
- [x] Tab navigation (impulses, members, settings)
- [x] Impulse form with group selector (searchable dropdown)
- [x] Tenure-weighted queue display (position badge, tenure bar, cohort label)
- [x] Adaptive timer countdown (SVG circular ring with color transition)
- [x] Inline vote buttons with live tally (tenure breakdown toggle, weighted yes/no display)
- [ ] Tenure breakdown toggle
- [x] Member roster
- [x] Settings panel (bio, energy, timezone, nickname)
- [x] Governance tab
- [ ] Member search

### 4.5 Composer Modal (8/8 complete)
- [x] Full-screen overlay with threaded draft view
- [x] Real-time draft updates (SSE/WS)
- [x] Adaptive timer display
- [x] Lock transition animation
- [x] LLM summary cards
- [x] Summary voting with selection
- [x] Broadcast confirmation animation
- [x] "Send nothing" option

### 4.6 Profile (0/3 complete)
- [ ] Public profile with group memberships
- [ ] Message history
- [ ] Reputation indicators

### 4.7 Search (3/4 complete)
- [x] Global search for groups and public messages
- [x] Search page (desktop)
- [x] Search screen (mobile)
- [ ] Intra-group search scope toggle (mobile)
- [ ] Search results with highlights
- [ ] Keyboard shortcut (Cmd+K)

### 4.8 Group Creation (3/3 complete)
- [x] Group creation form
- [x] Shows as fringe until 5 members
- [x] Auto-generate first 5 invite codes

### 4.9 Settings & Admin (0/2 complete)
- [ ] Account settings
- [ ] Admin panel (banned words, fraud audit log)

### 5. Mobile — Expo (3/7 complete)
- [x] Bottom tab bar navigation
- [x] Stack navigation for drill-downs
- [x] Deep linking
- [x] Platform-specific nav
- [x] Search screen
- [ ] Auth screen (OAuth buttons)
- [ ] Push notification registration
- [ ] In-app notification center

### 5.2 Screens (6/6 done — basic scaffold)
- [x] Feed screen
- [x] Groups list screen
- [x] Group detail screen
- [x] Impulse/composer screen
- [x] Messages (DMs) screen
- [x] Profile screen

### 5.3 Mobile Web (2/3 complete)
- [x] mdot entry point (single-column)
- [x] Mobile-first navigation
- [ ] Reduced info density

### 5.4 Push Notifications (2/2 complete)
- [x] Expo push notifications setup
- [x] In-app notification center

### 6. LLM Integration (8/8 complete)
- [x] System prompt template with energy injection
- [x] Energy prompt variations
- [x] Content rules section
- [x] Summary generation from draft thread
- [x] Parse LLM response into 2-3 candidates
- [x] Fallback on invalid format
- [x] Timeout handling
- [x] Logging & monitoring

### 7. Security & Anti-abuse (2/8 complete)
- [x] Turnstile on sign-up
- [x] Rate limiting middleware (per-user, per-IP, per-group)
- [ ] Cohort analysis (batch + real-time)
- [ ] Activity gate calculation
- [ ] Vouch system UI + backend
- [ ] Shadow-ban pipeline
- [ ] Audit logging
- [ ] Input sanitization

### 8. Testing (0/8 complete)
- [ ] Unit tests: tenure calculation, tier assignment, adaptive timer
- [ ] Unit tests: vote threshold math, queue position
- [ ] Integration: impulse lifecycle (full cycle)
- [ ] Integration: OAuth, group creation, invite codes
- [ ] Integration: revocation, split, merge, sabbatical
- [ ] E2E: full user flow
- [ ] Load: voting at scale (1000 concurrent)
- [ ] Load: feed pagination

### 9. Deployment (5/8 complete)
- [x] Production Dockerfile
- [x] Database migration init container (via entrypoint.sh)
- [x] Health check endpoints (/health/live, /health/ready, /health/)
- [x] Log aggregation (stdout + structured JSON via logger.ts, request-logger.ts, telemetry.ts → OTLP)
- [x] Backup strategy for Postgres (pg-backup.sh → volume or S3, daily cron)
- [ ] Redis persistence (AOF or RDB)
- [ ] Monitoring alerts (health-monitor.sh wired, cron every 5m)
- [ ] Rollback strategy (rollback.sh + docs/deployment-monitoring-backup-rollback.md)

### 10. Documentation (3/6 complete)
- [x] README with setup
- [x] .env.example
- [x] TODO annotated tasks (this file)
- [ ] API reference (auto-generated from Hono routes)
- [ ] Architecture diagram
- [ ] Contribution guide

## Open Questions / Blockers

- **BLOCKING**: No rate limiting middleware — a single actor can hammer any endpoint. Per-user, per-IP, per-group limits needed.
- **BLOCKING**: Auth is minimal (x-user-id header only) — no OAuth sessions, Turnstile, or real identity layer.

## Notes

- Most complete area: Impulse lifecycle engine, group management (7/8), messages/feed (5/5)
- Least complete: Governance, fraud detection, LLM integration, notifications, mobile
- ~41% overall — 84/203 deliverables. Core group operations all wired: create, join, leave, update settings, nicknames, invite codes. Voting: cast + tally by tenure cohort. Messages: feed, revoke, endorse with global rate limiting.
- Running: Postgres and Redis sidecars. Groupthink API container on port 4001.
