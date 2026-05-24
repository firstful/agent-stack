# Groupthink — Implementation Task List

## 1. Infrastructure

- [x] Create Postgres sidecar container definition (agent-stack format) — inline in agent-stack.json
- [x] Create Redis sidecar container definition — inline in agent-stack.json
- [x] Wire service discovery env vars so API can reach Postgres/Redis by hostname — in agent-stack.json env
- [x] Add `DATABASE_URL` and `REDIS_URL` to agent-stack.json env with correct container hostnames
- [x] Configure persistent volumes for Postgres data — volume mount for pgdata
- [ ] Run initial Drizzle migration on container start
- [ ] Verify reconciliation loop picks up all three containers
- [x] Fix Dockerfile for pnpm + multi-stage build
- [x] Add pnpm-workspace.yaml, remove package-lock.json

## 2. Database

- [ ] Add all missing indexes (search, feed ordering, impulse lookups, vote aggregation)
- [ ] Add composite indexes for common query patterns (group_id + status on impulses, group_id + joined_at on memberships)
- [x] Add `invite_codes` table (code, group_id, created_by, used_by, used_at, expires_at)
- [ ] Add `vouch_requests` table (requester_id, group_id, vouched_by, status, created_at)
- [ ] Add `rate_limits` table (group_id, action_type, window_start, count)
- [ ] Add `energy_history` table (group_id, energy, changed_at, voted_by)
- [ ] Add `group_blocks` table (source_group_id, target_group_id)
- [ ] Add `banned_words` table (word, added_by, added_at)
- [ ] Create seed migration with demo groups, users, and sample impulses

## 3. Backend API (Hono)

### 3.1 Authentication
- [x] Implement OAuth register/login endpoint (`POST /api/auth/register`, `GET /api/auth/me`)
- [ ] Implement OAuth callback handlers for Google, GitHub, Apple
- [ ] Create session management (JWT or cookie-based)
- [ ] Add Cloudflare Turnstile verification on sign-up
- [ ] Add auth middleware that populates `x-user-id` from session
- [ ] Add onboarding flow (username selection after first OAuth)

### 3.2 Groups
- [x] Create group endpoint (creates hidden fringe group, generates 5 invite codes)
- [x] Invite code generation endpoint (max 5 unused codes, with availability check)
- [x] Join group via invite code endpoint (single-use codes, checks existing membership)
- [ ] Leave group endpoint
- [ ] Update group settings endpoint (bio, timezone, energy — with 72hr cooldown check)
- [ ] Nickname CRUD endpoints (set, update, delete nickname for target group)
- [ ] Block/unblock group endpoints (impulse blocking)
- [x] Group creation starts as fringe, auto-promotes via member count (tierForMemberCount helper)
- [ ] Tier-based interaction filter on incoming impulses

### 3.3 Impulse Lifecycle
- [ ] Implement state machine: queued → voting → composing → summarizing → approval → broadcast
- [ ] Auto-advance from queued to voting when tenure-weighted queue position reaches top
- [ ] Adaptive voting timer logic:
  - Start at max (4h) when first vote cast
  - Shrink timer proportionally to vote velocity and consensus ratio
  - Collapse immediately if supermajority reached early
  - Expire at max timer if engagement too low
  - Redis-backed TTL for timer events
- [ ] Voting endpoint with tenure-weighted vote recording
- [ ] Auto-advance from voting to composing when threshold met (or expire if not met)
- [ ] Composer lock logic (adaptive timer from first draft, or manual lock by vote)
- [ ] LLM summary generation trigger on lock (call OpenAI-compatible endpoint)
- [ ] Summary approval phase with voting on candidates
- [ ] Broadcast handler (create public message on summary selection, or discard)
- [ ] Impulse expiry handler (move to expired status, optionally archive)

### 3.4 Composer / Drafts
- [ ] Draft submission endpoint (with parent_draft_id for threading)
- [ ] Draft retrieval (ordered by thread ancestry)
- [ ] Real-time draft push via WebSocket or Redis pub/sub + SSE

### 3.5 Messages / Feed
- [x] Feed endpoint with cursor-based pagination
- [x] Tier filter on feed (user's minimum tier setting)
- [x] Single message endpoint
- [x] Revocation endpoint (checks 24h window, requires supermajority vote)
- [ ] Retweet/endorsement endpoint (with global rate limit check)

### 3.6 Voting
- [ ] Vote casting (upsert: update existing vote or insert new)
- [ ] Vote tally endpoint (returns weighted totals, breakdown by tenure cohort)
- [ ] Adaptive timer recalculation on each vote
- [ ] Vote suppression for flagged accounts (fraud detection hooks)

### 3.7 Search
- [ ] Full-text search on public messages (Postgres tsvector)
- [ ] Group name/bio search
- [ ] Intra-group search endpoint (requires membership)

### 3.8 Direct Messages
- [ ] Send DM endpoint (within group, sender + recipient in same group)
- [ ] List DMs for a user (inbox)
- [ ] Thread view for a DM conversation

### 3.9 Governance
- [ ] Vote-kick endpoint (initiate, vote, execute)
- [ ] Group split endpoint (vote, member-side selection, create new group)
- [ ] Group merge endpoint (initiate, mutual vote, combine memberships)
- [ ] Sabbatical vote endpoint (initiate, vote, duration selection, early-terminate)

### 3.10 Fraud Detection
- [ ] Cohort analysis: flag accounts from same creation window voting identically
- [ ] Cross-group observation: flag accounts with identical join/vote patterns
- [ ] Activity gate: calculate voting weight modifier based on non-voting engagement
- [ ] Vouch system: accelerate weight for vouched accounts, cap unvouched
- [ ] Behavioral heuristics: detect same-vote blocs, identical timing
- [ ] Shadow-ban endpoint: reduce weight for flagged accounts
- [ ] Audit log for fraud flags (admin view)

### 3.11 Content Moderation
- [ ] Banned words check on broadcast content (before LLM and after)
- [ ] LLM system prompt injection with content rules
- [ ] Report endpoint for public messages

### 3.12 Scheduled Jobs
- [ ] Reputation decay job (daily: reduce inactive members' weight)
- [ ] Impulse expiry job (minute: check adaptive timers)
- [ ] Sabbatical expiry job (hourly: end sabbatical when time elapses)
- [ ] Invite code cleanup job (daily: expire old codes)

## 4. Desktop Web (Next.js)

### 4.1 Auth
- [ ] OAuth login buttons (Google, GitHub, Apple)
- [ ] Turnstile widget on sign-up
- [ ] Auth callback pages
- [ ] Session persistence
- [ ] Auth middleware redirects

### 4.2 Layout
- [ ] Three-panel shell (nav, main, detail) — existing scaffold
- [ ] Responsive breakpoint that collapses right sidebar on smaller screens
- [ ] Loading skeletons for all panels
- [ ] Error boundaries per panel

### 4.3 Home Feed
- [x] Real feed from API (replaced mock data, fetches from /api/feed)
- [x] Tier filter dropdown (select min tier, re-fetches feed)
- [ ] Sort toggle (newest, popular)
- [ ] Infinite scroll pagination
- [ ] Reply button → creates impulse, redirects to group detail
- [ ] Endorse button with count
- [ ] Revocation banner styling
- [ ] Energy badge display
- [ ] Nickname display (if viewer's group assigned one)
- [ ] Thread indicator (if part of conversation thread)

### 4.4 Group Detail
- [x] Real impulses from API (fetches from /api/groups/:id/impulses)
- [x] Impulse creation form with inline title/description
- [x] Invite codes display in settings tab (view + generate)
- [x] Tier and energy badges
- [x] Tab navigation (impulses, members, settings)
- [ ] Impulse creation form with group selector (search for target group)
- [ ] Tenure-weighted queue display
- [ ] Adaptive timer countdown per impulse
- [ ] Inline vote buttons with live tally
- [ ] Tenure breakdown toggle on vote bar
- [ ] Member roster with full list, tenure, activity status
- [ ] Settings panel: bio editor, energy selector (with 72hr cooldown), timezone, nickname manager
- [ ] Governance tab: split, merge, sabbatical vote
- [ ] Member search within group

### 4.5 Composer Modal
- [ ] Full-screen overlay with threaded draft view
- [ ] Real-time draft updates (SSE/WebSocket)
- [ ] Adaptive timer display
- [ ] Lock transition animation
- [ ] LLM summary cards display after lock
- [ ] Summary voting with selection highlight
- [ ] Broadcast confirmation animation
- [ ] "Send nothing" option

### 4.6 Profile
- [ ] Public profile with group memberships
- [ ] Message history (user's groups' public messages)
- [ ] Reputation/reputation indicators

### 4.7 Search
- [x] Global search for groups and public messages (GET /api/search)
- [x] Search page (reads q param, fetches results)
- [ ] Intra-group search scope toggle
- [ ] Search results with highlights
- [ ] Keyboard shortcut (Cmd+K)

### 4.8 Group Creation
- [x] Group creation form (name, bio, initial energy)
- [x] Shows as fringe until 5 members
- [x] Auto-generate first 5 invite codes

### 4.9 Settings & Admin
- [ ] Account settings (email notifications, tier preferences)
- [ ] Admin panel for banned words management
- [ ] Admin panel for fraud detection audit log

## 5. Mobile (Expo)

### 5.1 Navigation
- [ ] Bottom tab bar: Feed, Groups, Messages, Profile
- [ ] Stack navigation for drill-downs (group detail, impulse, composer)
- [ ] Deep linking setup
- [ ] Platform-specific nav (iOS tab bar, Android bottom nav, web top bar)

### 5.2 Screens
- [x] Feed screen (fetches from /api/feed, real data)
- [x] Groups list screen (fetches from /api/groups)
- [x] Group detail screen with tabs (fetches impulses from API)
- [x] Impulse/composer screen (fetches drafts, sends new drafts)
- [x] Messages (DMs) screen (fetches from API)
- [x] Profile screen (fetches groups)
- [ ] Search screen
- [ ] Auth screen (OAuth buttons)

### 5.3 Mobile Web (mdot route)
- [ ] Separate entry point with single-column layout
- [ ] Mobile-first navigation (swipe gestures, bottom sheet modals)
- [ ] Reduced info density vs native

### 5.4 Push Notifications
- [ ] Setup Expo push notifications
- [ ] Notify on: impulse needing vote, composer opening, summary ready, new DM
- [ ] In-app notification center

## 6. LLM Integration

- [ ] Design system prompt template with energy injection
- [ ] Energy prompt variations (thoughtful, snarky, funny, mixed)
- [ ] Content rules prompt section (banned words, style constraints)
- [ ] Summary generation: pass full draft thread + impulse context
- [ ] Parse LLM response into 2-3 structured candidates
- [ ] Fallback if LLM returns invalid format (retry with stricter instructions)
- [ ] Timeout handling (if LLM takes too long)
- [ ] Logging and monitoring for LLM calls (cost, latency, failure rate)

## 7. Security & Anti-abuse

- [ ] Turnstile integration on sign-up
- [ ] Rate limiting middleware on all endpoints (per-user, per-IP, per-group)
- [ ] Cohort analysis implementation (batch job + real-time check)
- [ ] Activity gate calculation (score based on read/click/browse events vs pure vote)
- [ ] Vouch system UI + backend
- [ ] Shadow-ban flagging pipeline
- [ ] Audit logging for sensitive actions (votes, kicks, governance)
- [ ] Input sanitization (no HTML in messages)

## 8. Testing

- [ ] Unit tests: tenure calculation, tier assignment, adaptive timer formula
- [ ] Unit tests: vote threshold math, queue position sorting
- [ ] Integration tests: impulse lifecycle (create → vote → compose → summarize → broadcast)
- [ ] Integration tests: OAuth flow, group creation, invite code flow
- [ ] Integration tests: revocation, split, merge, sabbatical
- [ ] E2E test: full user flow (sign up → join group → create impulse → vote → draft → approve)
- [ ] Load test: voting at scale (simulate 1000 concurrent votes)
- [ ] Load test: feed pagination

## 9. Deployment

- [x] Production Dockerfile (multi-stage, pnpm-based, minimal runtime image)
- [ ] Database migration as init container or entrypoint script
- [ ] Redis persistence configuration (AOF or RDB)
- [ ] Health check endpoints for container orchestration
- [ ] Log aggregation (stdout + structured JSON)
- [ ] Monitoring alerts (LLM failure rate, vote anomalies, error rate)
- [ ] Backup strategy for Postgres
- [ ] Rollback strategy (versioned desired JSON, DB migration rollback)

## 10. Documentation

- [x] README with setup instructions (prerequisites, install, run, OAuth setup, API reference)
- [x] .env.example with all required environment variables
- [ ] API reference (auto-generated from Hono routes)
- [ ] Architecture diagram (containers, data flow, impulse lifecycle)
- [ ] Moderation guide (banned words, report handling)
- [ ] Contribution guide
