# MVP Scope

## Phase 1

1. Chat completions compatibility
2. Transcript persistence
3. Simple summarization
4. remember() support
5. Hidden reinference loop
6. Token budgeting
7. Streaming passthrough

---

## Phase 2

1. Recursive summaries
2. search_memory()
3. Embedding retrieval
4. Responses API compatibility
5. Multi-provider routing
6. Semantic ranking

---

## Phase 3

1. Hierarchical memory DAG
2. Adaptive compression policies
3. Attention budgeting
4. Cross-session persistent memory
5. Predictive prefetch expansion
6. KV-cache-aware provider routing

---

# Phase 4: Profile System

## Motivation

Currently, a single account has a flat list of providers with one default model each. This doesn't support multi-agent scenarios where different roles (execution, summarization, embedding) need different model assignments, or where different conversation contexts need different compression policies.

The Profile system adds a configuration layer between the account and the inference endpoint, enabling per-agent behavior customization.

---

## Concepts

### Profile

A named configuration that assigns provider+model combinations to each functional role, sets compression behavior, defines context window limits, and selects available tools. Every profile gets its own auth token for scoped access.

```
Account
  ├── providers[]       (connection configs: apiKey, baseUrl, label)
  └── profiles[]        (behavior configs referencing providers)
        └── authToken   (profile-scoped auth for inference)
```

### Role

Each profile defines three functional roles:

| Role | Purpose |
|------|---------|
| `execution` | Primary chat/completions model |
| `summarization` | Model used for compression summarization |
| `embedding` | Model used for semantic vector generation |

Each role is assigned a provider label + model ID. The provider must exist in the account's provider list.

### Auto Model

A role can specify `"auto"` instead of a concrete model ID. When `"auto"` is used, the system selects the best available model from the role's assigned provider based on:
- capability requirements of the role
- user-defined model preference ranking (ordered list of model IDs or globs)

---

## Data Model

```typescript
interface ModelAssignment {
  provider: string
  model: string            // concrete model ID or "auto"
}

interface ProfileCompression {
  trigger: "token_count" | "message_count" | "idle_time"
  threshold: number
  rate: "low" | "medium" | "high"
}

interface Profile {
  id: string
  name: string
  execution: ModelAssignment
  summarization: ModelAssignment
  embedding: ModelAssignment
  compression: ProfileCompression
  contextWindow: number
  tools: string[]               // enabled hidden tool names
  authToken: string
  modelPreferences: string[]    // ordered model IDs for "auto" resolution
  createdAt: number
}
```

---

## Storage

Profiles live inside the Account:

```typescript
interface Account {
  token: string
  providers: ProviderConfig[]
  profiles: Profile[]
  createdAt: number
}
```

Profile data is persisted alongside existing account data (JSON file or Postgres).

---

## Auth

Two-tier auth:

| Token | Scope | Used For |
|-------|-------|----------|
| Account token | Management | CRUD profiles, manage providers |
| Profile token | Inference | Chat completions, models list |

Profile tokens are generated via `crypto.randomBytes(32).toString("hex")` on profile creation. They can be rotated without affecting the account token.

Profile-scoped endpoints authenticate by looking up the profile token across all accounts.

---

## API Endpoints

### Profile Management (requires Account token)

```
POST   /v1/profiles                          → Create profile
GET    /v1/profiles                           → List profiles
GET    /v1/profiles/:profileId                → Get profile
PUT    /v1/profiles/:profileId                → Update profile
DELETE /v1/profiles/:profileId                → Delete profile
POST   /v1/profiles/:profileId/regenerate-token → Rotate auth token
```

### Profile-Scoped Inference (requires Profile token or Account token)

```
POST   /v1/:profileId/chat/completions        → Chat completions using profile config
GET    /v1/:profileId/models                  → Models available in this profile
```

---

## Model Resolution

When a request arrives at a profile-scoped endpoint:

1. Authenticate via profile token (or account token)
2. Load the profile configuration
3. For each role (execution, summarization, embedding):
   a. Look up the assigned provider by label in the account's provider list
   b. If model is concrete, use it directly
   c. If model is "auto", resolve via modelPreferences:
      - Walk the modelPreferences list
      - For each preference, check if it exists in the provider's available models
      - First match wins
4. Route the request using the resolved provider+model

---

## Models List

`GET /v1/:profileId/models` returns all models from providers referenced in the profile, deduplicated, with ownership metadata. This endpoint is used by clients to discover what models are available for a given profile.

---

## Implementation Order

1. Add Profile types to types.ts, update Account
2. Add profile CRUD to IUserStore interface
3. Implement in UserStore (JSON) and PgUserStore (Postgres)
4. Add profile management endpoints + profile-scoped inference to gateway
5. Update web UI for profile management
6. Update cloudflared tunnel config if needed for profile-scoped URLs
