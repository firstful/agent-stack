# v2 — Cross-Org Federation + Admin Domain Controls

## Objective

Enable users in different Fuse instances (or different orgs on the same
instance) to communicate with the full richness of the Fuse protocol, not
just downgraded email. This turns email between orgs into a first-class
messaging experience.

## Concept

When OrgA and OrgB both run Fuse, Alice@a.com sending a message to Bob@b.com
triggers a different delivery path depending on whether the servers have
already negotiated an upgrade:

**First contact (SMTP path):**
1. Alice's server resolves MX for b.com
2. Connects via SMTP, EHLO handshake — both advertise `FUSE RICH-V1`
3. `STARTFUSE` upgrade happens (or reconnect to SRV-discovered Fuse port)
4. Alice's server sends a `RICH_MAIL` frame
5. Bob's server delivers it — but now both servers know about each other

**After upgrade (webhook path):**
Once both sides have negotiated Fuse capability, they exchange **webhook
endpoints** and **public keys** for direct message delivery:

```
Alice@a.com sends a message to Bob@b.com:
1. Alice's server checks: do I have b.com's webhook endpoint?
2. No → go through SMTP discovery (first contact flow above)
3. Yes → POST signed + encrypted payload to b.com's webhook URL
4. Bob's server verifies signature, decrypts, delivers
```

This webhook path is the primary delivery mechanism for all cross-org
communication once trust is established — not just email, but also chat
messages, presence updates, channel subscriptions, and meeting invites.

## Domain Trust Model

```
┌─────────────────────┐          ┌─────────────────────┐
│    OrgA (a.com)     │          │    OrgB (b.com)     │
│                     │          │                     │
│  Alice@a.com        │          │  Bob@b.com          │
│  ─────────────      │          │  ───────────        │
│                     │          │                     │
│  ┌───────────────┐  │  Fuse     │  ┌───────────────┐  │
│  │  Trusted       │──┼──────────┼──│  Trusted       │  │
│  │  Domains:      │  │  Protocol │  │  Domains:      │  │
│  │  - b.com       │  │          │  │  - a.com       │  │
│  │  - partner.org │  │          │  │  - vendor.com  │  │
│  └───────────────┘  │          │  └───────────────┘  │
└─────────────────────┘          └─────────────────────┘
```

### Trust Levels

| Level | Name | Behavior |
|-------|------|----------|
| 0 | Untrusted | Plain SMTP only. No upgrade. |
| 1 | Email-only | FUSE upgrade allowed. Rich mail, read receipts, reactions. |
| 2 | Presence | Level 1 + cross-org presence, typing indicators. |
| 3 | Collaboration | Level 2 + shared channels, direct chat, file sharing. |
| 4 | Full | Level 3 + meeting scheduling, doc collaboration. |

Org admins set the trust level for each domain. Default is Level 1.

### Verification / Proof of Trust

When domain `b.com` adds `a.com` as trusted at Level 3:
1. `b.com`'s admin enters `a.com` in the admin panel.
2. `b.com`'s server sends a verification challenge to `admin@a.com`.
3. `a.com`'s admin clicks a verification link (or a.com's admin pre-approves
   b.com via DNS TXT record).
4. Mutual trust is established.

### DNS-Based Auto-Discovery

To simplify cross-org trust, Fuse supports a DNS TXT record:

```
_fuse.domain.example TXT "v=FU1; trust=auto; level=3"
```

This tells other Fuse servers: "I'm a Fuse server, and I trust all domains
at this level." Equivalent to "open federation" at the specified level.

## Cross-Org Message Delivery

### Webhook Endpoints

Once two Fuse servers have negotiated an upgrade (via SMTP + STARTFUSE or
SRV record), they exchange webhook endpoints during the handshake. Each
server exposes:

```
/.well-known/fuse/webhook  — POST endpoint for incoming cross-org messages
/.well-known/fuse/keys     — Public key endpoint (GET)
```

The webhook URL and public key URL are included in the STARTFUSE response
payload, allowing both sides to cache them for future direct delivery.

### Public Key Cryptography

Every Fuse domain maintains a key pair. The private key signs outgoing
webhook payloads. The public key is published at `/.well-known/fuse/keys`
for anyone to verify.

```
OrgA (a.com)
├── Private key: signs all outgoing webhook payloads
├── Public key: published at https://a.com/.well-known/fuse/keys
│
│   POST https://b.com/.well-known/fuse/webhook
│   Headers:
│     X-Fuse-Signature: <base64(sign(private_key, body))>
│     X-Fuse-Domain: a.com
│     X-Fuse-Key-ID: <key-fingerprint>
│   Body: <encrypted-with-orgB-public-key>
│
OrgB (b.com)
├── Fetches OrgA's public key from https://a.com/.well-known/fuse/keys
├── Verifies signature
├── Decrypts body with OrgB's private key
└── Delivers message to recipient
```

**Encryption:** The webhook body is encrypted with the **receiver's public
key** (asymmetric encryption, or a hybrid: ECDH key exchange + AES session
key for large payloads). This ensures only the intended receiver can read
the payload.

**Signature:** The webhook is signed with the **sender's private key**. The
receiver verifies against the sender's published public key. This ensures
the message came from the claimed domain.

**Key rotation:** Domains can rotate keys. The `X-Fuse-Key-ID` header tells
the receiver which public key to use. Old keys are kept for a grace period
to handle in-flight messages.

### Delivery Flow

```
1. Alice posts message in #project-alpha shared channel
2. Alice's server (a.com) constructs delivery payload:
   {
     "type": "channel_message",
     "channel_id": "uuid",
     "sender": { "identity": "alice@a.com", "type": "human" },
     "body": { /* message content */ },
     "timestamp": "ISO8601",
     "message_id": "uuid"
   }
3. a.com signs the payload with its private key
4. a.com encrypts the payload with b.com's public key
5. a.com POSTs to https://b.com/.well-known/fuse/webhook
6. b.com fetches a.com's public key (from cache or keys endpoint)
7. b.com verifies signature
8. b.com decrypts payload
9. b.com applies inbound policy (trust level, identity type filters)
10. b.com delivers message to Bob
```

### Queue & Backoff

Failed deliveries use an **exponential backoff queue**:

```
1st failure:  retry in 30 seconds
2nd failure:  retry in 2 minutes
3rd failure:  retry in 8 minutes
4th failure:  retry in 30 minutes
5th failure:  retry in 2 hours
6th+ failure: retry in 8 hours (cap)
```

- Messages are queued in **order** per destination domain
- If server B was down for 2 hours, when it comes back, server A drains
  the queue in FIFO order, replaying all queued messages
- The queue is persisted (PostgreSQL) — survives server restart
- If the queue exceeds 10,000 pending messages for a domain, the sending
  server marks the domain as "degraded" and alerts the admin
- After 7 days of continuous delivery failure, the domain is marked as
  "unreachable" and trust is downgraded to Level 0 (plain SMTP only)
- When the domain recovers, a new SMTP handshake re-establishes the
  webhook endpoint

### Webhook vs SMTP Decision

| Scenario | Delivery mechanism |
|----------|-------------------|
| First message to a new domain | SMTP → STARTFUSE → exchange webhook endpoints |
| Subsequent messages | Webhook (signed, encrypted) |
| Webhook delivery fails 3+ times | Fall back to SMTP (plain email) |
| Webhook endpoint changes | Next SMTP handshake updates cached endpoint |
| Server has been down > 7 days | SMTP only, trust downgraded |

### Domain Approval Dashboard

Org admins can:
- View all domains that have sent email to the org
- Set trust level per domain (0-4)
- Set default trust level for new domains (default: Level 1)
- Revoke trust at any time
- View cross-org channel membership
- Set data retention policies per trust level
- Require approval before users create cross-org channels

### Identity Type Policy (per domain)

Since identity types are transparent in protocol frames, admins can set
fine-grained policies per trusted domain:

```
Domain: partner.org (Trust Level 3)
├── Allowed identity types: [human, shared]
├── Blocked identity types: [agent, service]
├── agent identities are → downgraded to email-only (Level 1)
├── shared identities can → join shared channels, post messages
└── human identities can → full Level 3 access
```

Policies are set at the domain level and can be overridden per shared channel.

| Policy | Description |
|--------|-------------|
| Allow all | Every identity type from domain X is treated equally |
| Block types | Messages from specified types are dropped or downgraded |
| Downgrade type | Messages from type `agent` → only email, no chat |
| Require human sender | Shared channels: only `human` and `shared` may post |
| Audit agent activity | Log all messages from `agent` types separately |
| Rate limit by type | Apply different rate limits per identity type |

### Identity Type Badging

Users see the identity type when interacting cross-org:

```
support@partner.org
├── Display: "Support (shared)"
├── Badge: 🏢 (for shared), 🤖 (for agent), 👤 (for human)
├── Hover: "Customer Support — shared identity at partner.org"
└── Click: "This identity is of type 'shared' — backed by one or more humans"
```

### User-Level Controls

Users can:
- See which external users are in their channels
- See identity type of external participants
- Report a cross-org user or message
- Block specific external identities (regardless of type)
- Mute all `agent` type identities in a channel
- Request admin to trust a new domain

## Shared Channels (Cross-Org)

When trust reaches Level 3, users can create shared channels:

```
#project-alpha (a.com + b.com)
├── Alice@a.com
├── Bob@b.com
├── Carol@a.com
└── AI-bot (present in every channel)
```

Shared channels work exactly like internal channels: messages, threads,
reactions, file sharing, AI agent with full context.

## Data Boundaries

Cross-org data is stored with strict tenant isolation:

- Messages in shared channels are stored on **both** servers (each org retains
  its own copy).
- Attachments are cached per-server; the originating server always holds the
  authoritative copy.
- Knowledge graph data never crosses org boundaries without explicit user
  action (e.g., inviting an external AI agent to access a calendar).

## v2 Does NOT Include

- Real-time chat UI (v4 — for now, cross-org rich email is served through the
  webmail UI)
- Voice/video (v5)
- Document store (v6)
