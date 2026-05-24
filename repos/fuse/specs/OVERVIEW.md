# Fuse (codename) — All-in-One Communication Platform

## Elevator Pitch

Fuse is an AI-native communication platform that unifies email, instant messaging,
voice/video calls, meetings, and document collaboration into a single system.
It starts as a **drop-in SMTP replacement** that any org can self-host and use
in a vacuum, but when two Fuse-enabled orgs talk to each other, they
automatically unlock federated rich collaboration — channels, presence,
real-time typing, meetings, and shared AI agents.

The core insight: **email is the lowest-common-denominator protocol for async
communication.** Rather than building a walled garden that replaces email, Fuse
wraps email with an upgrade path. Every Fuse server speaks SMTP natively. When
two servers discover each other can do more, they negotiate a transport upgrade
in the SMTP handshake itself.

## Core Design Principles

1. **Backward compatibility is non-negotiable.** SMTP is the floor, not the
   ceiling. A Fuse user can always email anyone on standard SMTP.
2. **Self-hosted-first, SaaS-optional.** Every piece of Fuse ships as a
   Docker/Podman stack. A single shared `core` package contains all business
   logic; the `server` package wraps it for single-tenant self-hosting and the
   `cloud` package adds multi-tenant SaaS features. No forking.
3. **Progressive enhancement.** Every communication mode (chat, meeting, doc,
   voice) builds on the same identity, permissions, and storage layer.
4. **AI is ambient.** Every channel has an implicitly available AI agent with
   full context — knowledge graph, calendar, past messages, docs.
5. **Fluid modality.** Turn a chat thread into an email. Turn a group chat into
   a meeting. Turn a message into a task. Modality is a view, not a container.
6. **Cross-org by default.** Federation is built in from day one. Org admins
   approve trusted domains, and then their users interact across org boundaries
   as if they were internal.

## Version Roadmap

| Version | Focus | Key Capability |
|---------|-------|----------------|
| v1 | Core Mail + SMTP Gateway | SMTP server with upgrade handshake, basic mail, protocol negotiation |
| v1b | Shared Mailboxes + Automation | Multi-user mailboxes, internal notes, task creation from email, canned responses, doc attachments |
| v2 | Cross-Org Federation | Domain trust, admin approvals, cross-org messaging, shared channels, cross-org mailboxes |
| v3 | Calendar + Meetings | Scheduling, calendar sync (CalDAV), video meetings, RSVP |
| v4 | Instant Messaging + Channels | Discord-like chat, threads, reactions, presence, real-time typing |
| v5 | Voice/Video Channels | Persistent open voice channels, screen sharing, push-to-talk |
| v6 | Document Store | Notion/Confluence-like docs, blocks, real-time coauthoring, templates |

## Server Architecture

**Monorepo, three packages.** All business logic lives in `packages/core`.
The `packages/server` and `packages/cloud` packages are thin composition
layers that wire `core` into different runtimes — single-tenant self-hosted
vs multi-tenant SaaS. No forking. No `if (SaaS)` conditionals in `core`.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Fuse Monorepo (packages/)                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  packages/core/ (100% shared — zero SaaS deps)              │   │
│  │                                                              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │
│  │  │  API      │ │  SMTP    │ │  Auth    │ │  AI Engine   │   │   │
│  │  │  Routes   │ │  Gateway │ │  + JWT   │ │  + KG        │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │
│  │  │  DB Repos │ │  Fed     │ │  Realtime│ │  Docs        │   │   │
│  │  │  + Types  │ │  Engine  │ │  (WS)    │ │  + Yjs       │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  Event Bus (30+ domain event types)                   │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐   │
│  │  packages/server/         │  │  packages/cloud/              │   │
│  │  (self-hosted runtime)    │  │  (SaaS additions)             │   │
│  │                           │  │                               │   │
│  │  • Auto-provision single  │  │  • Multi-tenant domain        │   │
│  │    domain on first boot   │  │    resolver (hostname/api-key) │   │
│  │  • Local admin panel      │  │  • Org signup + billing        │   │
│  │  • No SaaS deps (Stripe,  │  │  • Superadmin console          │   │
│  │    Bull, etc.)            │  │  • Job queue (Bull/BullMQ)      │   │
│  │  • docker-compose.yml     │  │  • docker-compose.cloud.yml    │   │
│  └──────────────────────────┘  └──────────────────────────────┘   │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Shared Infrastructure (docker-compose base)                │   │
│  │  PostgreSQL 16 │ Maddy (SMTP relay :2525) │ MinIO (S3)     │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌────────────────────────────────────────────────┐               │
│  │  Web UI (React SPA, separate package)          │               │
│  └────────────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

### How the three packages split

| Concern | `packages/core` | `packages/server` | `packages/cloud` |
|---|---|---|---|
| **Tenancy** | Unaware — receives `req.domain` already resolved | Auto-provisions a single domain on first boot | Multi-tenant resolver from hostname or API key |
| **DB schema** | All migrations (`001_initial.sql`) | Uses core migrations | Extends with `saas_` tables (plans, invoices) |
| **API routes** | All route handlers: identity, channel, message, meeting, doc, webhook, admin | Mounts core routes + setup wizard | Mounts core routes + superadmin + billing |
| **Auth** | JWT verify/session | Magic link only | OAuth/SSO + magic link + OIDC |
| **Config** | Zod schema for all shared vars | Ignores SaaS fields | Validates SaaS fields (`STRIPE_KEY`, etc.) |
| **Billing** | Not referenced | Not present | Stripe integration |
| **Background jobs** | Not referenced | Not present | Bull/BullMQ worker |
| **Quotas/limits** | Not referenced | None (disk-bound) | Per-plan quota middleware |
| **Docker image** | Build artifact only | `docker run fuse` | `docker run fuse-cloud` |
| **Dependencies** | `pg`, `jose`, `ws`, `zod`, `smtp-server` | Core deps only | Core + `stripe`, `bullmq` |

### When a `core` route runs

The tenancy is resolved **before** the route handler executes — the handler
never knows whether it's running in self-hosted or SaaS mode:

```
Request → Domain Resolver → req.domain injected → core route handler executes
         │                          │
         │ server:                  │ Always single domain, pre-provisioned
         │ cloud:                   │ Resolved from Host header or API key
         ▼                          ▼
         Both inject {id, name, config} onto req
```

- **Subsystems are modules** within `core`, not separate services
- **Shared PostgreSQL** for all persistent state (messages, users, identities,
  channels, knowledge graph, queues)
- **S3-compatible object store** for attachments, blobs, rich embeds
- **Vector embeddings** in pgvector (no separate vector DB)
- **Web UI** is a React SPA, served by the HTTP gateway, with WebSocket
  connections for real-time features
- **SMTP gateway** speaks SMTP natively (via `smtp-server`), relays to Maddy
  on port 2525; no IMAP (web UI + mobile apps are the only clients)
- **Federation engine** manages webhook push, key management, delivery queues

### Cloud Provider Abstraction

The codebase does not hardcode any cloud vendor. Services that speak standard
protocols connect via env vars and work everywhere. Services that require
proprietary SDKs are wrapped behind thin interfaces in `packages/cloud/providers/`:

| Service | Standard protocol (no adapter needed) | Provider adapter (`packages/cloud/providers/`) | Why |
|---|---|---|---|
| **Database** | PostgreSQL wire → any pg-compatible endpoint | — | Works with RDS, Cloud SQL, Azure Flexible Server, local pg |
| **Object storage** | S3 API → MinIO, S3, Cloud Storage, Azure Blob (S3 gateway) | — | Everything speaks S3 API or has a compat layer |
| **SMTP relay** | SMTP → Maddy, SES, SendGrid, any SMTP relay | — | Standard protocol |
| **Redis** | RESP → ElastiCache, Memorystore, Redis Cache | — | Standard protocol |
| **Transactional email** | SMTP or HTTP | `providers/email.ts` | Magic links, invites — SES SDK vs generic SMTP |
| **AI/LLM** | OpenAI-compatible HTTP | `providers/ai.ts` | Bedrock, Vertex AI, Azure OpenAI all offer OpenAI-compatible endpoints |
| **Queue** | Redis (Bull) for standard jobs | `providers/queue.ts` | Optional dead-letter to SQS / PubSub for long retention |
| **KMS/HSM** | — | `providers/kms.ts` | Server-side identity key storage — AWS KMS, GCP Cloud KMS, Azure Key Vault |

The `providers/index.ts` factory reads `FUSE_CLOUD_PROVIDER` (or detects from
env) and wires the right implementation. The rest of `cloud` — and all of
`core` — never imports a cloud SDK directly.

This isolates vendor lock-in to a few hundred lines of adapter code, all in
one directory, swappable per deployment.

### Multi-Region & Multi-Cloud Strategy

The federation engine doubles as a cross-shard routing layer, making true
multi-region write locality viable without distributed SQL.

#### Phase 1: Single-Region, Multi-AZ (launch)

Covers the 99.9% case — AZ failures far outnumber region outages.

```
┌───────────────── region us-east-1 ─────────────────┐
│  AZ-a          AZ-b          AZ-c                   │
│  ┌───┐         ┌───┐         ┌───┐                  │
│  │app│         │app│         │app│                  │
│  └───┘         └───┘         └───┘                  │
│  ┌──────────────────────────────────┐               │
│  │  pg:16 primary │ standby │ standby│              │
│  │  (sync rep)    │         │        │              │
│  └──────────────────────────────────┘               │
│  S3 (single-bucket)                                 │
└─────────────────────────────────────────────────────┘
```

- Postgres synchronous replication across 3 AZs
- App behind a load balancer
- S3 is already region-redundant
- All SaaS infra (Redis, Bull, Stripe) in the same region

#### Phase 2: Read Replicas in Remote Regions

Route read queries to local replicas; writes stay in the primary region.

```
us-east-1 (primary)          eu-west-1 (read replica)
┌──────────────────┐         ┌──────────────────┐
│ pg primary        │─async──│ pg read replica   │
│ app (writes)      │         │ app (reads)       │
│ S3 bucket         │←──────→│ S3 regional       │
│ Redis primary     │         │ (CRR replication) │
└──────────────────┘         └──────────────────┘
```

The repo layer already separates reads from writes at the function level.
A `pool.replica` connection string sends read queries locally:

```ts
// core/src/db/pool.ts
export const pool = {
  primary: new Pool({ connectionString: DATABASE_URL }),
  replica: new Pool({ connectionString: REPLICA_URL }),  // optional
};
```

**Tradeoff:** Async replication means small data loss on primary failure
(sub-second to seconds). Acceptable for chat/mail — not for accounting.

#### Phase 3: Domain-Based Sharding (multi-primary)

Every table has `domain_id`. Shard by domain, place each shard's primary in
the region closest to that org's users. Cross-shard communication reuses
the **federation protocol** (webhook push + Ed25519 signing) — no new
transport needed.

```
┌─ us-east-1 (shard 0) ─┐  ┌─ eu-west-1 (shard 1) ─┐
│ domains: Acme, Foo     │  │ domains: Blitz, Corp   │
│ identities, channels,  │  │ identities, channels,  │
│ messages, etc.          │  │ messages, etc.          │
└──────────┬─────────────┘  └──────────┬─────────────┘
           │                            │
           └──────────┬────────────────┘
                      │ federation webhook
                      ▼
           ┌──────────────────────┐
           │  Federation Engine   │
           │  (already exists)    │
           └──────────────────────┘
```

A shard router in `packages/cloud/shard-router.ts` resolves the target at
request time by looking up `domain_id → shard_id`:

```ts
// If the domain lives on a different shard, proxy via the
// federation webhook endpoint — same protocol, same retry logic.
if (shard.id !== LOCAL_SHARD) {
  return proxyToShard(shard, req);
}
```

For real-time cross-shard delivery, the receiving shard's federation
webhook handler pushes to the local WebSocket connection — identical to how
federated messages from external orgs are handled.

#### Multi-Cloud: Not Recommended Simultaneously

Running AWS + GCP + Azure at the same time adds enormous complexity for
marginal benefit. The cloud-portable provider layer already enables
**migration** between clouds via env vars — you just don't want to run
both at once.

| Concern | Multi-region (same cloud) | Multi-cloud (simultaneous) |
|---|---|---|
| **Database** | pg native replication | Needs CRDB/Spanner — ops nightmare |
| **Networking** | VPC peering, private links | Cross-cloud VPN, 5-9s latency |
| **SMTP** | Same SES/SendGrid account | Double deliverability config |
| **Observability** | One cloud stack | Aggregate across clouds |
| **Team expertise** | One cloud | 3x the operational surface |

#### Summary

| Phase | Strategy | Complexity | What it covers |
|---|---|---|---|
| 1 | Single-region, multi-AZ | Low | AZ failure, 99.9% of incidents |
| 2 | Read replicas in remote regions | Medium | Read latency for remote users |
| 3 | Domain sharding + federation protocol | Medium-High | Write locality, full multi-region |
| — | Multi-cloud simultaneously | Very High | Not recommended |

The federation engine is the enabler for Phase 3 — it gives you multi-primary
writes with AP semantics (eventual consistency) without needing distributed SQL.

## Registration & Onboarding

**Domain-claim model.** An org is created by verifying ownership of a domain.
Anyone with an email @ that domain can then claim their identity.

### Flow

```
1. Admin navigates to Fuse server, enters domain (e.g., company.com)
2. Fuse generates a DNS verification token:
   _fuse-verify.company.com TXT "fuse-verify=<random-token>"
3. Admin adds the TXT record to their DNS zone
4. Fuse polls DNS, verifies token → org is created
5. Admin sets up MX records pointing to the Fuse server
6. Users @company.com log in:
   a. Enter email → Fuse sends magic link to that address
   b. Click link → identity auto-created under the org
   c. Set display name, avatar, preferences
```

- **No user accounts exist before domain verification.** The org is created
  atomically with the DNS proof.
- **The org owner role** is assigned to the admin who performed verification.
  They can delegate ownership by adding other `human` identities as owners.
- **Multiple domains per org** is supported (e.g., `company.com` + `company.io`).
  Each domain must be verified independently.
- **Self-hosted shortcut:** A `server` package deployment auto-provisions a
  single domain on first boot, skipping DNS verification entirely.

## Authentication

Authentication is per-instance. A user authenticates to the Fuse server that
hosts their domain. There is no global auth.

### Self-Hosted: Magic Link Only

No passwords. No password storage, reset flows, or credential leaks.

```
1. User enters name@domain
2. Fuse sends a one-time magic link to that email (6-character code as fallback:
   for CLI, slow networks, or when email is already open on the same device)
3. Click/link → session token (JWT, short-lived + refresh)
4. Session persists across browser tabs; device token for mobile
```

- **Session:** JWT access token (15 min) + refresh token (30 day rotation, stored
  in `httpOnly` cookie for web, secure storage for mobile)
- **Multi-device:** Each device gets independent refresh tokens. Server tracks
  `(identity, device_id, refresh_token_hash)` — revocable per device via
  settings.
- **No passkeys in v1.** Deferred — the three-key E2EE model already covers
  device binding. Passkeys add UX complexity for little gain in a magic-link
  system.

### SaaS: OAuth/SSO + Magic Link

```
1. Landing page offers: "Continue with Google / GitHub / Microsoft" + "Email"
2. OAuth → user's email is verified by the provider → identity created
3. Email fallback → magic link sent to any email address
4. Enterprise tenants optionally configure OIDC via admin settings
```

- **OAuth providers:** Google, GitHub, Microsoft shipped in v1. Additional
  providers via community PRs.
- **OIDC (BYOIDP):** Enterprise tenants configure their own IdP via admin panel
  (metadata URL + client ID/secret). Available in v1.

### Post-Auth: Client Key Setup

After authentication, the client generates or imports keys:

```
1. Generate identity keypair (Ed25519) on device
2. Generate group management keypair (X25519) on device
3. Derive or import recovery key (Ed25519) — generated on first client,
   paper backup prompted
4. Upload public keys to server → published for the identity
5. From this point, E2EE operations use these keys directly
```

- Keys are **never** sent to the server except in RECOVER (where new public
  keys are signed by the recovery key).
- If the user has existing keys from a previous login on this device, they're
  reused (stored in IndexedDB / platform keychain).
- First login on a new device → recovery key needed for E2EE groups (see
  RECOVER in Shared Mode). Without recovery key, the device can still use
  non-E2EE channels and start new E2EE groups.

**Optional E2EE per conversation.** Users can enable end-to-end encryption on
any DM or private channel. Public channels and cross-org shared channels use
TLS-in-transit (server-side encryption at rest).

### Model Selection

The encryption model depends on the channel's participants:

| Channel type | Participants | Model | Server can decrypt? |
|-------------|--------------|-------|-------------------|
| 1:1 DM | Two `human` identities | **E2EE** — Signal X3DH + Double Ratchet | No |
| Group chat | Only `human` identities | **E2EE** — shared K_g, epoch hashes, per-member key delivery | No — relays ciphertext only |
| Group with shared identity | Humans + `shared`/`agent`/`service` | **E2EE with S2EE property** — same protocol, but server-side identity's keys live on server | Yes — via the server-side identity's keys |
| External bridge | Inbound SMTP / webhook → group | **S2EE proxy** — server-side identity re-encrypts external content into the group's E2EE | Yes — necessary for bridging non-Fuse content |

The E2EE protocol is documented below (Async / Shared / Blob modes). The
S2EE proxy bridge is documented at the end of this section.

> **Advisory:** When a `shared`, `agent`, or `service` identity is added to an
> E2EE channel, all participants see a modal warning that the server will now
> hold encryption keys for the channel (S2EE property). See the Rules section
> for the exact wording.

### Privacy Slider

Every channel has a per-channel privacy slider controlling server-side access:

```
🔒 E2EE ────🔐 E2EE+Search────🔓 S2EE
```

| Level | Label | Search | AI agent can join? | Server can decrypt? |
|-------|-------|--------|-------------------|---------------------|
| 🔒 | E2EE | Client-only (download all, decrypt locally) | No | No |
| 🔐 | E2EE + Search | Encrypted keyword trie on server | No | No (sees keyword frequency) |
| 🔓 | S2EE | Full plaintext search | Yes | Yes |

**Default per channel type:**

| Channel contains… | Default slider position |
|-------------------|------------------------|
| Only `human` identities | 🔒 or 🔐 (user choice at creation) |
| `shared`, `agent`, or `service` identities | 🔓 (S2EE) — server must hold keys for those identities |
| Moved from lower to higher | Possible — slide up (more privacy) anytime |
| Moved from higher to lower | Only if no server-side identity is a member. Changing from 🔓 to 🔐 or 🔒 removes the server's ability to decrypt — new messages use fresh K_g, old messages remain decryptable by the server until epoch rotation. |

---

### Server-Mediated P2P Model

#### Async Mode

Uses **Signal's X3DH + Double Ratchet** for 1:1 DMs. For groups: one shared
`K_g` for encryption, per-member Ed25519 signatures for sender auth.

```
Group key: K_g — single AES-256 key per group
Identity keys: each member has Ed25519 (sk, pk)

Alice sends:
  ciphertext = AEAD_encrypt(K_g, message, epoch_hash || "alice@domain")
  signature = sign(Alice_sk, ciphertext || epoch_hash)

Bob receives:
  verify_signature(Alice_pk, ciphertext || epoch_hash, signature)
  plaintext = AEAD_decrypt(K_g, ciphertext, epoch_hash || "alice@domain")
```

**No coordination needed for regular messaging.** Sender encrypts alone.
Offline recipients decrypt on reconnect.

#### Epoch Hash — Membership Binding

Every membership change (add, remove, leave) creates a new **epoch**. The
epoch hash binds the exact membership state into every encryption:

```
epoch_hash[0] = H(genesis_sorted_member_list || genesis_key_fingerprints)
epoch_hash[N] = H(
    epoch_hash[N-1] ||
    epoch_N ||
    sorted_member_list ||
    member_key_fingerprints
)
```

Every encrypted message includes `epoch_hash[N]` as AEAD associated data.
On receive, decryption silently fails if the receiver's current epoch hash
doesn't match. This means:

- **Replay prevention:** A removed member's old ciphertexts cannot be
  replayed into the current epoch
- **Implicit membership verification:** A member who missed a membership
  change gets a failed decrypt, forcing them to fetch the latest epoch state
- **Cheap:** 32 bytes per message, no extra round trips

#### History Sharing for New Members

By default, a new joiner can only decrypt messages from the epoch they joined.
History sharing is **explicit admin-only** — no automatic backfill.

```
Admin triggers "share history with Carol (joined at epoch N+1)":

1. Admin's client batches old messages (epochs 0-N), one per AEAD encrypt:
   for each historical message M with epoch_hash[M]:
     ciphertext = AEAD_encrypt(K_g_new, M.plaintext,
                                epoch_hash[N+1] || "history:carol@domain")
     signature = sign(Admin_sk, ciphertext || epoch_hash[N+1])

2. Server receives these as new message objects with the same message_id
   and a history flag. It delivers them as messages in the group.

3. Carol's client:
   - Decrypts with K_g_new
   - Sees "history" flag → renders under a history header
   - Message IDs are new (she didn't have them before)

4. Existing members' clients:
   - Receive the same messages
   - Check message_id → already have it → **silently deduplicate**
   - Show a system banner: "📜 Alice shared history with new members"
```

| Concern | Behavior |
|---------|----------|
| Who can share? | Admins only |
| What gets shared? | Messages re-encrypted with current K_g_new (epoch of the new joiner) |
| Existing members see dupes? | No — deduped by message_id; they see a single system message |
| Carol sees timeline? | Yes — messages render as "History — shared by Alice" under a section header, sorted by original timestamp |
| Forward secrecy? | Carol has these old messages permanently (they're re-encrypted to her epoch's key). Acceptable — an admin explicitly chose to share. |

---

### Shared Mode — Epoch Key Rotation

Every membership change (INVITE, REMOVE, JOIN, RECOVER) rotates `K_g`. This
requires coordination — the new key must be delivered to all intended
recipients via their group management public keys. This is distinct from
async mode where anyone can encrypt alone.

#### Server as Epoch Sequencer

The server assigns monotonically increasing epoch numbers for all shared-mode
operations. This prevents concurrent conflicts (two simultaneous INVITEs both
claiming epoch N+1). Members propose changes; the server sequences them:

```
Alice sends INVITE → Server assigns epoch N+1, broadcasts rotation
Bob sends INVITE  → Server assigns epoch N+2, broadcasts rotation
```

The server cannot forge shared-mode payloads (it doesn't hold any member's
GM private key or identity key), nor can it decrypt message content. Its
role is strictly ordering and relay. For RECOVER, the server additionally
validates the recovery signature and generates K_g_new (since the recovering
member doesn't have K_g_old).

Membership changes use two messages — both update the membership state and
both must complete for the change to be valid.

##### Key Types

Every identity has three asymmetric keypairs:

| Key | Purpose | Algorithm | Backed up? |
|-----|---------|-----------|------------|
| **Identity key** | Signing messages, auth, JOIN verification | Ed25519 | No — device-only |
| **Group management key** | Receiving encrypted K_g updates | X25519 | No — device-only |
| **Recovery key** | Authorizing new device keys after loss | Ed25519 | **Yes** — paper phrase, offline backup |

The recovery key is cold-stored and never used day-to-day. If Alice loses her
device, she generates fresh identity and GM keys on a new device, then signs
them with her recovery key to prove she still controls her identity. The group
accepts this as a shared-mode operation and distributes K_g to her new keys.

All three public keys are published when the identity is created and included
in the epoch hash computation for the group.

##### Add Member: INVITE → JOIN

```
Phase 1 — INVITE (existing member → group):

Alice constructs K_g_new, then encrypts it individually to each member's
group management public key:

{
  type:          "INVITE"
  inviter:       "alice@domain"
  new_member:    "carol@domain"
  new_member_pk: Carol_identity_pk
  epoch:         N+1
  key_payloads:  [
    { member: "bob@domain",  encrypted: E(Bob_gm_pk, K_g_new) },
    { member: "eve@domain",  encrypted: E(Eve_gm_pk, K_g_new) },
  ],
  sig: sign(Alice_identity_sk, hash(payload))
}

Members verify Alice's sig, find their own key_payload, decrypt K_g_new
with their group management private key:
  ✓ Signed by Alice → attributable, not forgeable by other K_g_old holders
  ✓ Carol is now a "pending" member
  ✓ All existing members rotate to K_g_new[N+1]

Carol receives K_g_new out-of-band (invite link, direct message, admin UI).
```

```
Phase 2 — JOIN (new member → group):

Carol broadcasts, signed with her identity key:
{
  type:   "JOIN"
  member: "carol@domain"
  epoch:  N+1
  sig:    sign(Carol_identity_sk, "JOIN" || "carol@domain" || epoch_N+1)
}

Verified by existing members using Carol_identity_pk from the INVITE:
  ✓ Carol controls carol@domain
  ✓ Matches a pending INVITE (referenced by member_identity + epoch)
  ✓ Carol is now an "active" member

Members optionally advance to epoch N+2 with K_g_fresh
(clean break: one epoch for INVITE transition, one for JOIN confirmation).
```

| State | Who has K_g_new | Can decrypt future messages? |
|-------|----------------|------------------------------|
| Before INVITE | Existing members (K_g_old) | No — need K_g_new |
| After INVITE | Existing members | ✓ (rotated to K_g_new) |
| After INVITE (Carol) | Carol (OOB) | ✓ (has K_g_new) |
| After JOIN confirmed | All active members | ✓ |

##### Remove Member: Per-Member Key Delivery

Removal is a single broadcast from an admin, but unlike INVITE it uses
**per-member encrypted payloads**. The admin encrypts K_g_new individually
to each remaining member's group management public key. The removed member
gets no payload → cannot learn the new epoch key.

```
Admin removes Dave:

Admin fetches each remaining member's group management public key.
Generates K_g_new. Encrypts it for each remaining member:

{
  type:       "REMOVE"
  admin:      "alice@domain"
  removed:    "dave@domain"
  epoch:      N+1
  key_payloads: [
    { member: "bob@domain",   encrypted: E(Bob_gm_pk, K_g_new) },
    { member: "carol@domain", encrypted: E(Carol_gm_pk, K_g_new) },
    { member: "eve@domain",   encrypted: E(Eve_gm_pk, K_g_new) },
  ],
  sig: sign(Admin_identity_sk, hash(payload))
}

Members:
  1. Verify admin's signature → authorized admin
  2. Find their own entry in key_payloads
  3. Decrypt K_g_new with their group management private key
  4. Start using K_g_new for all future messages

Dave:
  - No payload for dave@domain → no K_g_new
  - Old K_g_old still decrypts past messages
  - Any message encrypted with K_g_old fails epoch_hash check → can't inject
```

| Does Dave have K_g_new? | Can Dave read new messages? | Can Dave send forgeable messages? |
|------------------------|---------------------------|-----------------------------------|
| No | No — epoch_hash won't match | No — signed with K_g_old fails epoch check |

##### Recover Member: Device Loss

If Alice loses her device, she generates fresh identity and GM keys on a new
device, then broadcasts a RECOVER message signed with her offline recovery key.
The server acts as arbiter — it validates the recovery signature, sequences the
epoch, and issues the shared-mode rotation to distribute `K_g_new`:

```
Alice generates new keys:
  Alice_identity_sk_2 / Alice_identity_pk_2
  Alice_gm_sk_2       / Alice_gm_pk_2

Alice broadcasts (unencrypted, signed with recovery key):

{
  type:           "RECOVER"
  member:         "alice@domain"
  old_epoch:      N
  new_identity_pk:  Alice_identity_pk_2
  new_gm_pk:        Alice_gm_pk_2
  sig:            sign(Recovery_sk, hash(payload))
}

Server:
  1. Fetches Alice's published recovery public key
  2. Verifies sig → Alice controls her identity
  3. Generates K_g_new
  4. Encrypts K_g_new to each remaining member's GM public key
     (including Alice's new gm_pk_2)
  5. Broadcasts the rotation:
     {
       type:        "ROTATE"
       sequencer:   "server"
       triggering:  "RECOVER" / "alice@domain"
       epoch:       N+1
       key_payloads: [
         { member: "alice@domain", encrypted: E(Alice_gm_pk_2, K_g_new) },
         { member: "bob@domain",   encrypted: E(Bob_gm_pk, K_g_new) },
         ...
       ],
       sig: sign(Server_identity_sk, hash(payload))
     }

Members: verify server sig → find own payload → decrypt K_g_new → rotate.
Alice on new device: decrypts K_g_new with her new GM key → joins epoch N+1.
Old device: has no valid payload for epoch N+1 → locked out.
```

| Concern | Handled? | Caveat |
|---------|----------|--------|
| Recovery without K_g_old | ✓ | RECOVER signed with recovery key |
| Server can't read messages | ✓ | Server generates K_g but never sees plaintext |
| Old device locked out after recovery | ✓ | Epoch change, no key_payload for old GM key |
| Attacker with stolen device | **Limitation** | Between theft and RECOVER, attacker can read/post as Alice. No cryptographic detection during the window. Members see "Alice recovered" notification but attacker's messages blend into history. |
| Recovery key backup security | ✓ | Critical: recovery key must be cold-stored; compromise = permanent identity theft |

---

### Blob Mode — Large Attachments

Files, images, videos, and other large payloads are encrypted with a
**random per-blob key**, then that key is distributed via async mode:

```
blob_key = random(32)
blob_ciphertext = AEAD_encrypt(blob_key, file_data, ad=file_metadata_hash)

// Key distributed via async mode:
key_message = AEAD_encrypt(K_g, blob_key, epoch_hash || sender || file_id)
key_sig = sign(sender_sk, key_message || epoch_hash)

→ blob_ciphertext → S3/MinIO (keyed by file_id)
→ key_message + key_sig → in-channel async message
```

Recipient fetches blob ciphertext from object store, decrypts the blob key
from the async message using `K_g`, then decrypts the blob.

- No large data touches `K_g`
- Blob key is ephemeral, one per file
- Access control inherits from async mode — only current epoch members can
  decrypt the key message
- Server stores only ciphertext in S3; cannot decrypt
- Old blob keys persist within an epoch (no forward secrecy for blobs)
  — acceptable tradeoff for storage efficiency


| | Per-sender keys | Single key + sigs |
|--|----------------|-------------------|
| Add member | O(N) parallel | **O(N)** |
| Remove member | **O(N²)** | **O(N)** |
| Send | O(1) | O(1) + 1 signature |
| Receive | O(1) | O(1) + 1 verify |

#### Tradeoff: Epoch-Internal Key Reuse

Within an epoch, all messages use the same K_g. If K_g is compromised, every
message in that epoch is compromised. Per-sender keys give per-message forward
secrecy (each sender can ratchet their own key independently).

This is acceptable because:
- Epochs are bounded by membership changes, which are infrequent
- Compromise requires active device access during the epoch window
- The epoch hash prevents cross-epoch replay regardless

For higher-security conversations, members can manually trigger a key rotation
(which creates a new epoch) on demand.

### Search Index — Encrypted Keyword Trie (CTR-based SSE)

At the 🔐 privacy level ("E2EE + Search"), clients send an encrypted keyword
index to the server alongside every message. The index uses AES-CTR as a
**prefix-preserving encryption** (PPE) scheme, enabling server-side prefix
search without exposing plaintext keywords.

**Key:** Each group has a **non-rotating** `K_search` (separate from `K_g`,
distributed alongside `K_g_1` on join). Non-rotating because rotation would
require re-indexing all prior keywords.

**Indexing callback (client → server, per sent message):**

```
for each keyword w in message:
  enc_w = AES_CTR(K_search, w)    // prefix-preserving
  send (enc_w, message_id) to server

Server stores in a trie:
  enc_w[0] → enc_w[1] → ... → leaf: [message_id1, message_id2, ...]
```

**Search (client queries server):**

```
Client: enc_query = AES_CTR(K_search, search_input)
→ send enc_query to server

Server: traverse trie at enc_query prefix
→ return all message_ids under that node

Client: fetch messages by message_id, decrypt with K_g (by epoch)
```

Because CTR is prefix-preserving, `"dog"` → `7f3a` and `"doge"` → `7f3a1b`
share the trie path `7 → f → 3 → a`. This gives **autocomplete and prefix
search** without the server learning plaintext.

| Property | Behavior |
|----------|----------|
| Same keyword → same ciphertext | Yes — trie deduplicates naturally; server sees frequency |
| Prefix search | Works — prefix-preserving CTR |
| Frequency leakage | Server sees which encrypted keywords appear together across messages |
| Blowup | 1 trie entry per unique keyword per group (not per occurrence) |
| Search rotation on recovery | Deterministic from K_search — no re-index needed |

**Leakage consideration:** The server sees which encrypted prefixes are
related to each other (correlated with plaintext structure) and how many
messages share each encrypted keyword. This is acceptable because the server
already knows message volume, timing, sender, group membership, and size.

**At 🔒 (E2EE without search index):** No trie entries are sent. Clients
search by fetching and decrypting all messages locally — acceptable for small
channels, impractical for large ones. The privacy slider controls this
per-channel.

**`K_search` lifecycle:**
- Generated on channel creation (alongside `K_g_1`)
- Distributed to new joiners in the INVITE payload (same message as `K_g_new`)
- **Never rotates** — fixed for the group's lifetime
- Derivable from a deterministic seed if needed, but separate from `K_g` (since `K_g` rotates)

### Channel Genesis — Initial Key Distribution

How `K_g_1` is created depends on channel size:

#### 1:1 DM: Creator Encrypts (Option A)

```
1. Alice's client generates K_g_1 and epoch_hash[0]
2. Alice fetches Bob's GM public key from server
3. Alice encrypts K_g_1 to Bob's GM key:
   encrypted_k = E(Bob_gm_pk, K_g_1)
4. Alice sends CREATE_DM:
   {
     type:         "CREATE",
     epoch:        0,
     epoch_hash:   H(["alice@a.com","bob@b.com"] || [...key_fingerprints]),
     key_payloads: [
       { member: "alice@a.com", encrypted: nil },  // she already has it
       { member: "bob@b.com",   encrypted: encrypted_k }
     ],
     sig: sign(Alice_identity_sk, hash(payload))
   }

5. Server stores the channel, delivers to Bob on reconnect
6. Bob decrypts K_g_1 with his GM private key → ready to chat
```

**Properties:** Pure E2EE. Server never sees K_g. Latency of 1 asymmetric op.
Trivially works with offline recipients (server queues the CREATE message).

#### Groups: Server Mediates (Option B)

Same protocol as **RECOVER** — the server generates `K_g_1`, encrypts it to
each initial member's GM public key, and broadcasts the CREATE message:

```
1. Alice creates "#engineering" with Bob@b.com, Carol@c.com
2. Server fetches Bob's and Carol's GM public keys
   (Alice's GM key is also fetched — she's a member)
3. Server generates K_g_1 and epoch_hash[0]:
   epoch_hash[0] = H(sorted_member_list || member_key_fingerprints)
4. Server encrypts K_g_1 to each member's GM public key:
   {
     type:         "CREATE"
     creator:      "alice@a.com"
     epoch:        0
     epoch_hash:   epoch_hash[0]
     members:      ["alice@a.com", "bob@b.com", "carol@c.com"]
     key_payloads: [
       { member: "alice@a.com", encrypted: E(Alice_gm_pk, K_g_1) },
       { member: "bob@b.com",   encrypted: E(Bob_gm_pk, K_g_1) },
       { member: "carol@c.com", encrypted: E(Carol_gm_pk, K_g_1) },
     ]
     sig: sign(Server_identity_sk, hash(payload))
   }
5. Server distributes to all members (online push + offline queue)
6. Each member decrypts K_g_1 with their GM private key
```

**Properties:** Server generates K_g but **cannot decrypt** — it encrypts to
members' GM keys and doesn't hold any member's GM private key. Same trust
model as RECOVER (already accepted). No plaintext window. No single point of
failure (if Alice disconnects, the CREATE is already sequenced).

| Aspect | 1:1 DM (Option A) | Group (Option B) |
|--------|-------------------|------------------|
| Who generates K_g? | Creator's client | Server |
| Server sees K_g? | No | Encrypted — server generates but encrypts to GM keys immediately |
| Trust requirement | None | Server can't read (same as RECOVER) |
| N of asymmetric ops | 1 encrypt | N encrypts (server-side, cheap) |
| Offline recipient? | Works — queued CREATE | Works — queued CREATE |
| Fallback to Option A for groups | Unnecessary — B scales | ✗ |
| Fallback to Option B for 1:1 | Unnecessary — A is simpler | ✗ |

**`K_g` and `K_search` are both generated during channel genesis** (same
message, same distribution mechanism).

### Rules

**E2EE conversations are marked with a 🔒 badge in the channel list.
Messages in E2EE conversations are NOT stored server-side in plaintext;
the server only stores encrypted ciphertext + metadata (sender, timestamp,
epoch_hash).

**Adding a server-side identity to a P2P channel.** If a user adds a `shared`,
`agent`, or `service` identity to a channel that was previously pure-human
P2P E2EE, all participants receive a modal advisory at the add action:

> "Adding @support to this channel will change the encryption model.
> This channel will no longer use peer-to-peer end-to-end encryption.
> Messages will be encrypted at rest on the server and on user devices,
> but the server will hold the channel's encryption keys.
> Past messages remain E2EE and won't be affected. Continue?"

A persistent system message is posted in the channel once confirmed:

> ────── ❖ ──────
> 🔓 **Encryption mode changed to S2EE (server-hosted keys)**
> @support was added by @alice. New messages are encrypted at rest on
> the server and on user devices, but the server holds the encryption key.
> Past E2EE messages remain end-to-end encrypted and visible to existing
> members. [Learn more about E2EE vs S2EE]
> ────── ❖ ──────

Once a server-side identity has joined, the channel cannot return to E2EE
mode (removing the identity does not retroactively make past messages
server-blind — the proxy key may have been cached).

- **Knowledge graph** does not index E2EE content. Only metadata (who talked
  to whom, when) is stored for the KG
- **Federation:** E2EE is not supported cross-org in v1-v2 (TLS only).
  Cross-org E2EE is a future enhancement

---

### S2EE — Server-Decryptable Groups

When a server-side identity (`shared`, `agent`, `service`) is a member of a
group, that group uses the same E2EE protocol (shared K_g, epoch hashes,
per-member key delivery) — but the server-side identity's keys live on the
server. This means the server can decrypt the group's messages.

**S2EE is not a separate channel model.** It's the same E2EE protocol, but
with at least one member whose keys are server-hosted. The group functions
identically — messages encrypted with K_g, membership changes via INVITE/
JOIN/REMOVE, epoch rotation on changes.

#### What S2EE Enables: External Content Bridging

The key function of a server-side identity is bridging external/non-Fuse
content into the group. When an email arrives via SMTP for support@:

```
External email: customer@example.com → support@company.com
  → SMTP inbound (no Fuse upgrade)
  → Server decrypts the plain text
  → support@ (the server-side identity) encrypts it to the group's K_g:
    AEAD_encrypt(K_g, "message from: customer@example.com — Help with billing",
                 epoch_hash || "support@company.com")
    + sign(Support_sk, ciphertext || epoch_hash)
  → Message appears in the group as a normal post from support@
  → All members decrypt with K_g, verify support@'s signature
```

When a member acts-as support@ and replies:
```
UserA acting as support@:
  → Drafts reply in the group channel
  → Message is encrypted with K_g, signed with UserA's identity key
    (since UserA is the one backing support@ in this moment)
  → Server sees the message from support@ in the group
  → Server extracts plaintext (has support@'s keys)
  → Sends as plain SMTP reply to customer@example.com
```

#### External Email → Group: The Proxy Path

```
customer@example.com
    │
    ▼ SMTP (plain)
┌──────────────┐
│ SMTP Gateway │  → decrypts, routes to support@
└──────┬───────┘
       │ plaintext
       ▼
┌──────────────────────────────────────┐
│ support@ (server-side identity)      │
│  → Encrypts to group's K_g           │
│  → Signs with support@'s identity key│
│  → Posts to group as "support@"       │
└──────────────────────────────────────┘
       │ AEAD(K_g, ...)
       ▼
┌──────────────────────────────────────┐
│ Group members                        │
│  → Decrypt with K_g                  │
│  → Verify support@'s signature       │
│  → See: "support@ — message from:    │
│           customer@example.com"      │
└──────────────────────────────────────┘
```

The group stays E2EE throughout. The server-side identity is the bridge —
it receives external content (SMTP, webhook) and re-encrypts it into the
group's E2EE stream.

#### Non-Email External Content

Same mechanism works for any external input:
- **Webhook**: CI/CD tool posts to a webhook URL → routed to a `service`
  identity → encrypted into the group's K_g → members see it in-channel
- **Bridge message**: Slack/Teams bridge → external message handled by a
  `service` identity → encrypted into the group

#### Key Storage

The server-side identity's private keys (identity key + GM key) are stored on
the server, isolated from the rest of the infrastructure:
- Self-hosted: key file with restricted permissions, or HSM-backed
- SaaS: HSM or encrypted at rest with a tenant-specific key
- Compromise of the identity keys exposes all messages in groups that
  identity belongs to (but NOT groups the identity is NOT in, and NOT
  user-to-user 1:1 DMs between human members)

#### Summary: E2EE vs S2EE

| | E2EE | S2EE |
|--|-----------|-------|
| When | Pure `human` groups | Channels with `shared`/`agent`/`service` identities |
| Group key | Shared K_g, rotated on membership change | Server-side identity keypair (persistent) |
| Server can read? | No — relays ciphertext | Yes — identity keys on server |
| Membership change | INVITE/JOIN/REMOVE with per-member K_g delivery | ACL update — identity re-encrypts |
| Device recovery | RECOVER signed with recovery key, epoch rotation | New 1:1 stream with the server-side identity |
| Complexity | Higher (distributed key agreement) | Lower (server-managed) |
| Trust model | Zero-trust server for group content | Server-trusted for group content |

## Identity Model

### Primary Key

Every identity's canonical key is `name@domain` — which is also a valid email
address. Examples: `alice@company.com`, `support@company.com`, `ai-bot@company.com`.

### Identity Types

Every identity has a **type** that describes what it is:

| Type | Description | Examples |
|------|-------------|----------|
| `human` | A natural person | `alice@company.com` |
| `agent` | An AI-driven bot or assistant | `ai-bot@company.com`, `calendar-bot@company.com` |
| `shared` | A team/service identity backed by multiple humans | `support@company.com`, `sales@company.com` |
| `service` | An automated system integration (CI/CD, webhook source) | `deploy-bot@company.com`, `jira@company.com` |
| `guest` | A limited external participant | `vendor@partner.com` (guest access) |

The type enum is extensible (plug-in custom types).

### Identity Types Are Transparent

Identity type travels with every protocol frame. When Bob receives a message
from `support@company.com`, his server knows the sender type is `shared`.
This enables **type-aware policy**:

- OrgA admin: "Drop all messages from `agent` type identities at OrgB."
- OrgB admin: "Only allow `human` and `shared` types to join shared channels."
- Channel moderator: "Mute all `agent` identities in this channel."
- SLA router: "Route `shared` type messages to our support queue."

### Domain Ownership

- **Orgs own domains.** An org is the set of identities @ their domain.
- **Federation is per-domain trust**, approved by org admins.
- **Identity verification:** An org cryptographically vouches for its
  identities' types. If an org says `support@company.com` is type `shared`,
  other orgs trust that assertion (the org is accountable for its own
  identities).
- **Cross-org identity:** When OrgA trusts OrgB, a `human` at OrgA sees a
  `shared` identity at OrgB as "Support (shared) — company.com" with
  presence, avatar, and type badge.
