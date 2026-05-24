# v1 — Core Mail + SMTP Gateway with Upgrade Handshake

## Objective

Deliver a drop-in SMTP server that any org can self-host. It must:
- Send and receive standard email with any SMTP server on the internet.
- Advertise a Fuse upgrade capability during the SMTP handshake (EHLO).
- When the remote server also advertises Fuse, negotiate a transport upgrade
  that unlocks richer data structures (reactions, threads, read receipts,
  rich text) over the same SMTP connection.
- **No IMAP.** The web UI and mobile apps are the only clients. Export tool
  for data portability.

## Existing Software Layer

Base on **Maddy** (github.com/foxcpp/maddy) — a modern,
composable SMTP implementation in Go that supports:
- SMTP/Submission/IMAP in one binary
- Message queues and retries
- Storage backends (SQL, local filesystem)
- Simple config format

**Why Maddy:** Single binary, well-architected, per-domain config, easy to
extend with custom storage and protocol handlers. Its modular pipeline design
lets us inject the Fuse upgrade logic cleanly.

## SMTP Upgrade Protocol (Fuse ESMTP Extension)

### Two Discovery Mechanisms

Fuse supports two complementary discovery mechanisms:

1. **EHLO keyword on port 25** — During standard SMTP handshake, advertise
   FUSE capability. If both sides support it, upgrade the same connection.
2. **SRV record** (`_fuse._tcp.domain`) — Pre-flight lookup before sending.
   If the target domain has a Fuse SRV record, the sender can skip SMTP
   entirely and connect directly to the Fuse port for a richer experience.

A sending server always tries EHLO first (for SMTP backward compat). If the
SRV record exists, it can be used as a direct upgrade path. The EHLO
response can optionally include the SRV-discovered port in its value:

```
S: 250-FUSE RICH-V1 PORT=9443
```

### Send Flow (Decided)

On send, the sending server does:

```
1. Resolve MX for recipient domain
2. Connect via SMTP to MX host
3. EHLO handshake — check for FUSE keyword
4. If FUSE advertised:
   a. Optionally resolve _fuse._tcp SRV for dedicated Fuse port
   b. STARTFUSE to upgrade the connection (or reconnect to SRV port)
   c. Send RICH_MAIL frame
5. If FUSE NOT advertised:
   a. Fall back to standard SMTP DATA command
   b. Send plain RFC5322 email
```

**No retroactive upgrade.** Previous messages in a thread remain as whatever
format they were sent in. The upgrade only applies to messages sent after
the STARTFUSE negotiation. If Alice and Bob exchange 10 plain emails and
then their servers negotiate FUSE, message #11 onward get rich treatment.

### EHLO Keyword Advertisement

```
C: EHLO client.fuse.example
S: 250-fuse.fuse.example Hello client.fuse.example
S: 250-SIZE 52428800
S: 250-FUSE RICH-V1 PORT=9443
S: 250 AUTH PLAIN LOGIN
```

The `FUSE` EHLO keyword advertises Fuse capability. The value `RICH-V1`
indicates the supported upgrade protocol version. `PORT=9443` is optional —
it tells the client there's a dedicated Fuse listener on a different port
(also discoverable via `_fuse._tcp` SRV record).

### SRV Record Discovery

```
_fuse._tcp.example.com. 3600 IN SRV 10 5 9443 fuse.example.com.
```

- Priority/weight: standard SRV semantics for failover/load balancing
- Port: the TCP port where the Fuse protocol listener runs
- Target: hostname of the Fuse server (can differ from MX host)
- If the SRV record exists, the client may connect directly to this port
  and initiate the Fuse protocol immediately (no SMTP preamble needed)
- If no SRV record, fall back to port 25 EHLO + STARTFUSE

### STARTFUSE — The Upgrade Command

After EHLO, if both sides advertise FUSE, the client sends:

```
C: STARTFUSE RICH-V1
S: 220 Ready to switch to Fuse protocol
[Connection upgrades to binary frames]
```

After `STARTFUSE`, the connection upgrades from line-based SMTP to a
length-prefixed binary frame protocol over the same TCP/TLS socket.

### Frame Format (post-upgrade)

```
┌───────────────────────────────────────────────┐
│ Frame (variable length)                       │
├─────────┬─────────────┬────────────────────────┤
│ Type    │ Payload Len  │ Payload               │
│ (1 B)   │ (Varint, LE) │ (Type-dependent)      │
├─────────┼─────────────┼────────────────────────┤
│ 0x01    │ 4            │ ...                    │
│ (RICH)  │              │                        │
└─────────┴─────────────┴────────────────────────┘
```

Frame types:
- `0x01 RICH_MAIL` — Rich email (superset of RFC5322 with reactions, threads,
  inline replies, rich text body in addition to plain+HTML)
- `0x02 PRESENCE` — Presence update (online, away, DND, typing)
- `0x03 PING` / `0x04 PONG` — Keepalive
- `0x05 CHANNEL` — Channel subscription (used in v2+ for cross-org channels)
- `0x06 MEETING` — Meeting invitation payload (v3+)
- `0xFF TERMINATE` — Graceful downgrade/close

### Fault Tolerance

If `STARTFUSE` fails or the remote server doesn't advertise `FUSE`, the
connection continues as plain SMTP. **No functionality is lost** — a Fuse user
can always send plain email. The upgrade is purely additive.

### Legacy Email Marker

Emails received from domains that **do not** have the Fuse upgrade are
rendered as a distinct object type in the UI — not as "messages" but as
**"external mail"** with a very visible visual treatment:

```
┌──────────────────────────────────────────────────────────┐
│ 📧 EXTERNAL EMAIL — Plain SMTP · gmail.com              │
│  From: bob@gmail.com        Delivered: 2h ago            │
│  To:   alice@company.com                                  │
│  Subject: Re: Project timeline                            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [Plain SMTP rendering — no rich features available]   │ │
│ │                                                       │ │
│ │ "Sounds good, let's finalize on Thursday."            │ │
│ │                                                       │ │
│ │ ——— Original Message ———                              │ │
│ │ From: Alice                                             │ │
│ │ Sent: ...                                               │ │
│ │ ...                                                     │ │
│ └──────────────────────────────────────────────────────┘ │
│  🛈 Limited interaction — reply will send as plain email  │
│  [Reply via SMTP]  [View Raw]  [Block Sender]            │
└──────────────────────────────────────────────────────────┘
```

Design rules:
- **Container border** — distinct color/border from Fuse-native messages
  (e.g., orange/amber border vs. default gray, or a dashed border)
- **Header badge** — "EXTERNAL EMAIL" or "LEGACY MAIL" with the sender's
  domain, clearly stating the transport was plain SMTP
- **No rich features** — no reactions, no read receipts, no threading hints,
  no typing indicator. The email is static text.
- **Footer disclaimer** — "Limited interaction — reply will send as plain
  email" or "This sender doesn't support rich features"
- **Thread boundary** — If a thread mixes Fuse-native and legacy emails,
  the legacy ones are visually grouped and separated from Fuse-native
  messages with a clear divider
- **Separate inbox** — Optionally, legacy emails can be routed to a
  separate "External Mail" folder/inbox tab rather than mixed with
  Fuse-native messages (user-configurable)
- **Reply is always SMTP** — replying to a legacy email goes out via
  plain SMTP; the reply itself is a RICH_MAIL only if the sender also
  supports Fuse (detected on next send)

Data model distinction:

```
Message {
  id: uuid
  transport: "internal" | "fuse" | "smtp"
  // "internal" = same server delivery (direct DB + WebSocket push)
  // "fuse"     = Fuse-to-Fuse (STARTFUSE, SRV direct, or webhook — all Fuse protocol)
  // "smtp"     = plain SMTP, no upgrade available
}
```

This `transport` field controls the UI rendering. In the channel view
(v4) and inbox, `transport: "smtp"` messages always render in the legacy
container. `transport: "internal"` and `transport: "fuse"` render as full
rich messages.

### RICH_MAIL Frame Payload

```jsonc
{
  "message_id": "<uuid@domain>",
  "rfc5322_envelope": { /* standard from/to/cc/bcc/subject */ },
  "sender": {
    "identity": "support@company.com",
    "type": "shared"
    // Identity type travels with every frame. Cross-org receivers
    // use this for policy enforcement before delivery.
  },
  "body": {
    "plain": "text plain fallback",
    "html": "<html>rich version</html>",
    "blocks": [
      // Structured content blocks like Slack's Block Kit
      { "type": "section", "text": "Hello world" },
      { "type": "reaction", "emoji": "👍", "target_message_id": "..." },
      { "type": "thread_reply", "parent_message_id": "..." },
      { "type": "attachment", "file_id": "..." }
    ]
  },
  "metadata": {
    "read_receipt": "requested" | "disabled",
    "importance": "low" | "normal" | "urgent",
    "expires_at": "ISO8601"
  }
}
```

A Fuse server receiving a RICH_MAIL stores it natively. When relaying to a
non-Fuse server, it flattens to a standard RFC5322 message (plain text + HTML
alternative, stripping Fuse-only metadata).

## Storage

- **Primary:** PostgreSQL (messages, mailboxes, users, domains)
- **Blobs:** S3-compatible object store (attachments, rich embeds)
- **Search:** Built-in PostgreSQL full-text search for v1; dedicated search
  index (Meilisearch/Tantivy) planned for v2

## User-Facing Features (v1)

| Feature | Description |
|---------|-------------|
| Standard email | Send/receive via SMTP/IMAP with any standard client |
| Fuse-to-Fuse rich email | Reactions, threads, read receipts, rich blocks |
| Webmail UI | Modern single-page app (React) |
| Per-domain config | Multi-tenant from day 1 |
| Aliases | Multiple addresses per user |
| Shared mailboxes | Multi-user mailboxes (support@, sales@) with roles and linked channel |
| Internal notes | Side conversations on emails visible only to mailbox members |
| Internal doc attachments | Embed Fuse docs in internal notes on emails |
| Manual task creation | Convert any email into a task with assignee, due date, and bidirectional link |
| Canned responses | Reusable reply templates with variables, per-mailbox or org-wide |

## What Works Without Upgrades

A Fuse user can:
- Send email to any @gmail.com, @outlook.com, etc.
- Receive email from any standard SMTP sender
- Use any standard IMAP client (Thunderbird, Apple Mail)
- The Fuse-only features (reactions, threads) are simply invisible/silently
  dropped when communicating with non-Fuse servers.

## What v1 Does NOT Include

- Cross-org federation (v2)
- Chat channels (v4)
- AI agent (v2+, prototype in v1)
- Mailbox automation rules, SLA tracking, queues, macros (v1b basic / v2 advanced)
