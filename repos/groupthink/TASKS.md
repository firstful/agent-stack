# Groupthink — Backlog

## Overview

Collaboration platform for impulse-driven group composition with adaptive voting, LLM summarization, and real-time feedback. Next.js + Hono API + Postgres/Redis. Significant gap between spec and implementation — core infrastructure runs but most business logic is unimplemented.

## Status

- **Completion**: ~60/203 deliverables done (~30%)
- **Phase/Stage**: Pre-alpha — API scaffold exists, sidecars running, frontend screens render. Business logic (impulse lifecycle, voting engine, governance) unimplemented.
- **Last updated**: 2026-05-28

## Deliverables

### 1. Infrastructure (7/10 complete)
- [x] Postgres sidecar container (agent-stack.json)
- [x] Redis sidecar container
- [x] Service discovery env vars (DATABASE_URL, REDIS_URL)
- [x] Persistent volume for Postgres
- [x] Production Dockerfile (multi-stage, pnpm)
- [x] pnpm-workspace.yaml, removed package-lock.json
- [x] Agent-stack.json with both sidecars wired
- [ ] Run initial Drizzle migration on container start
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

### 3.2 Groups (5/8 done)
- [x] Create group endpoint (hidden fringe group, 5 invite codes)
- [x] Invite code generation endpoint (max 5 unused codes)
- [x] Join group via invite code
- [ ] Leave group endpoint
- [ ] Update group settings (bio, timezone, energy with 72hr cooldown)
- [ ] Nickname CRUD endpoints (set, update, delete for target group)
- [ ] Block/unblock group endpoints
- [x] Group creation starts as fringe, auto-promotes via member count
- [ ] Tier-based interaction filter on incoming impulses

### 3.3 Impulse Lifecycle (0/16 complete)
- [ ] Implement state machine: queued → voting → composing → summarizing → approval → broadcast
- [ ] Auto-advance queued → voting when tenure-weighted queue position reaches top
- [ ] Adaptive voting timer (start at 4h, shrink by velocity/consensus, collapse on supermajority)
- [ ] Tenure-weighted vote recording endpoint
- [ ] Auto-advance voting → composing when threshold met
- [ ] Composer lock logic (adaptive timer or manual lock)
- [ ] LLM summary generation trigger on lock
- [ ] Summary approval phase with voting
- [ ] Broadcast handler (public message or discard)
- [ ] Impulse expiry handler

### 3.4 Composer / Drafts (0/3 complete)
- [ ] Draft submission endpoint (with parent_draft_id for threading)
- [ ] Draft retrieval (ordered by thread ancestry)
- [ ] Real-time draft push (SSE or WebSocket)

### 3.5 Messages / Feed (4/5 complete)
- [x] Feed endpoint with cursor-based pagination
- [x] Tier filter on feed
- [x] Single message endpoint
- [x] Revocation endpoint (24h window, supermajority)
- [ ] Retweet/endorsement endpoint (with global rate limit)

### 3.6 Voting (0/4 complete)
- [ ] Vote casting (upsert: update or insert)
- [ ] Vote tally endpoint (weighted totals by tenure cohort)
- [ ] Adaptive timer recalculation on each vote
- [ ] Vote suppression for flagged accounts

### 3.7 Search (2/3 complete)
- [ ] Full-text search on public messages (Postgres tsvector)
- [x] Group name/bio search
- [x] Intra-group search endpoint (requires membership)

### 3.8 Direct Messages (0/3 complete)
- [ ] Send DM endpoint
- [ ] List DMs for a user (inbox)
- [ ] Thread view for DM conversation

### 3.9 Governance (0/4 complete)
- [ ] Vote-kick endpoint (initiate, vote, execute)
- [ ] Group split endpoint (vote, member-side selection)
- [ ] Group merge endpoint (initiate, mutual vote)
- [ ] Sabbatical vote endpoint

### 3.10 Fraud Detection (0/7 complete)
- [ ] Cohort analysis — flag accounts from same creation window
- [ ] Cross-group observation — identical join/vote patterns
- [ ] Activity gate — voting weight modifier based on non-voting engagement
- [ ] Vouch system — accelerate weight for vouched accounts
- [ ] Behavioral heuristics — same-vote blocs, timing
- [ ] Shadow-ban endpoint
- [ ] Audit log for fraud flags

### 3.11 Content Moderation (0/3 complete)
- [ ] Banned words check on broadcast
- [ ] LLM system prompt injection with content rules
- [ ] Report endpoint for public messages

### 3.12 Scheduled Jobs (0/4 complete)
- [ ] Reputation decay job (daily)
- [ ] Impulse expiry job (minute)
- [ ] Sabbatical expiry job (hourly)
- [ ] Invite code cleanup job (daily)

### 4. Desktop Web — Auth (0/5 complete)
- [ ] OAuth login buttons (Google, GitHub, Apple)
- [ ] Turnstile widget on sign-up
- [ ] Auth callback pages
- [ ] Session persistence
- [ ] Auth middleware redirects

### 4.2 Layout (1/4 complete)
- [x] Three-panel shell scaffold (nav, main, detail)
- [ ] Responsive breakpoint (collapses right sidebar)
- [ ] Loading skeletons for all panels
- [ ] Error boundaries per panel

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

### 4.4 Group Detail (5/14 complete)
- [x] Real impulses from API
- [x] Impulse creation form (inline)
- [x] Invite codes display
- [x] Tier and energy badges
- [x] Tab navigation (impulses, members, settings)
- [ ] Impulse form with group selector
- [ ] Tenure-weighted queue display
- [ ] Adaptive timer countdown
- [ ] Inline vote buttons with live tally
- [ ] Tenure breakdown toggle
- [ ] Member roster
- [ ] Settings panel (bio, energy, timezone, nickname)
- [ ] Governance tab
- [ ] Member search

### 4.5 Composer Modal (0/8 complete)
- [ ] Full-screen overlay with threaded draft view
- [ ] Real-time draft updates (SSE/WS)
- [ ] Adaptive timer display
- [ ] Lock transition animation
- [ ] LLM summary cards
- [ ] Summary voting with selection
- [ ] Broadcast confirmation animation
- [ ] "Send nothing" option

### 4.6 Profile (0/3 complete)
- [ ] Public profile with group memberships
- [ ] Message history
- [ ] Reputation indicators

### 4.7 Search (2/4 complete)
- [x] Global search for groups and public messages
- [x] Search page
- [ ] Intra-group search scope toggle
- [ ] Search results with highlights
- [ ] Keyboard shortcut (Cmd+K)

### 4.8 Group Creation (3/3 complete)
- [x] Group creation form
- [x] Shows as fringe until 5 members
- [x] Auto-generate first 5 invite codes

### 4.9 Settings & Admin (0/2 complete)
- [ ] Account settings
- [ ] Admin panel (banned words, fraud audit log)

### 5. Mobile — Expo (0/5 complete)
- [ ] Bottom tab bar navigation
- [ ] Stack navigation for drill-downs
- [ ] Deep linking
- [ ] Platform-specific nav
- [ ] Search screen
- [ ] Auth screen (OAuth buttons)

### 5.2 Screens (6/6 done — basic scaffold)
- [x] Feed screen
- [x] Groups list screen
- [x] Group detail screen
- [x] Impulse/composer screen
- [x] Messages (DMs) screen
- [x] Profile screen

### 5.3 Mobile Web (0/3 complete)
- [ ] mdot entry point (single-column)
- [ ] Mobile-first navigation
- [ ] Reduced info density

### 5.4 Push Notifications (0/2 complete)
- [ ] Expo push notifications setup
- [ ] In-app notification center

### 6. LLM Integration (0/8 complete)
- [ ] System prompt template with energy injection
- [ ] Energy prompt variations
- [ ] Content rules section
- [ ] Summary generation from draft thread
- [ ] Parse LLM response into 2-3 candidates
- [ ] Fallback on invalid format
- [ ] Timeout handling
- [ ] Logging & monitoring

### 7. Security & Anti-abuse (0/8 complete)
- [ ] Turnstile on sign-up
- [ ] Rate limiting middleware (per-user, per-IP, per-group)
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

### 9. Deployment (1/8 complete)
- [x] Production Dockerfile
- [ ] Database migration init container
- [ ] Redis persistence (AOF or RDB)
- [ ] Health check endpoints
- [ ] Log aggregation (stdout + structured JSON)
- [ ] Monitoring alerts
- [ ] Backup strategy for Postgres
- [ ] Rollback strategy

### 10. Documentation (3/6 complete)
- [x] README with setup
- [x] .env.example
- [x] TODO annotated tasks (this file)
- [ ] API reference (auto-generated from Hono routes)
- [ ] Architecture diagram
- [ ] Contribution guide

## Open Questions / Blockers

- **BLOCKING**: Port 3000 conflict — opencode systemd service occupies host port 3000. Groupthink agent-stack.json needs `auto_port: true` or a different static port.
- **BLOCKING**: Impulse lifecycle engine — the state machine is spec'd but nothing auto-advances impulses. This is the single biggest functional gap — all the adaptive voting, tenure-weighted queues, and state machines are inert without it.
- Controller currently cannot start groupthink main containers; only sidecars (db, redis) are running.
- No rate limiting anywhere — a single actor can hammer any endpoint.

## Notes

- Most complete area: Infra (sidecars, Dockerfile, service discovery)
- Least complete: Impulse lifecycle (core product loop), governance, fraud detection, LLM integration
- ~30% overall — API scaffold and frontend screens render but business logic is largely unwired
- Running: Postgres and Redis sidecars only. Both groupthink slots down.
