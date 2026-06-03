# Groupthink

A deliberative social platform where groups interact through structured, democratic voting with LLM-mediated communication synthesis.

## Architecture

```
apps/
  api/       Hono/TypeScript REST API
  nextjs/    Desktop web app (Next.js, 1920x1080)
  expo/      Mobile app (React Native/Expo, Android+iOS+mobile-web)
packages/
  shared/    Zod schemas and shared types
  db/        Drizzle ORM schema + migrations
```

## Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16+
- Redis 7+
- OpenAI-compatible LLM endpoint

## Setup

```bash
# Install dependencies
pnpm install

# Build shared packages
pnpm build:packages

# Set up environment variables
cp .env.example .env
# Edit .env with your database URL, Redis URL, and LLM endpoint

# Create database and run migrations
pnpm db:push

# Start development servers
pnpm dev
```

Individual apps can be started separately:

```bash
pnpm dev:api     # API on :3000
pnpm dev:nextjs  # Desktop web on :3001
pnpm dev:expo    # Expo dev server
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://localhost:5432/groupthink` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `LLM_ENDPOINT` | OpenAI-compatible LLM API | `https://api.openai.com/v1` |
| `LLM_API_KEY` | LLM API key | — |
| `APP_PORT` | API server port | `3000` |
| `NEXT_PUBLIC_API_URL` | API URL for web client | `http://localhost:3000` |

## OAuth Setup

Groupthink uses OAuth-only authentication (no email/password). Configure these env vars for the provider(s) you want:

| Provider | Variables |
|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` |

Cloudflare Turnstile is required on sign-up: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/feed` | Public message feed |
| POST | `/api/auth/register` | Register new user (OAuth) |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create group |
| GET | `/api/groups/:id` | Group detail |
| GET | `/api/groups/:id/members` | Group members |
| GET | `/api/groups/:id/invite-codes` | Get invite codes |
| POST | `/api/groups/:id/invite-codes` | Generate new invite code |
| POST | `/api/join` | Join group via invite code |
| POST | `/api/groups/:id/impulses` | Create impulse |
| GET | `/api/groups/:id/impulses` | List impulses |
| GET | `/api/impulses/:id` | Impulse detail |
| POST | `/api/impulses/:id/vote` | Cast vote |
| POST | `/api/impulses/:id/draft` | Send draft |
| GET | `/api/impulses/:id/drafts` | List drafts |
| GET | `/api/impulses/:id/summaries` | List summary candidates |
| GET | `/api/messages/:id` | Message detail |
| POST | `/api/messages/:id/revoke` | Revoke message |
| POST | `/api/dms` | Send direct message |
| GET | `/api/dms` | List DM inbox (conversations) |
| GET | `/api/dms/:id` | DM conversation thread view |
| GET | `/api/search` | Search groups and messages |

All API requests (except auth/register) require `x-user-id` header with the user's UUID.

## Group Tiers

| Tier | Members | Visibility |
|---|---|---|
| Fringe | 1-4 | Hidden (invite only) |
| Small | 5-49 | Visible |
| Medium | 50-199 | Visible |
| Large | 200-999 | Visible |
| Huge | 1,000-9,999 | Visible |
| Massive | 10,000+ | Visible |

## License

MIT
