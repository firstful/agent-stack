# v1b — Team Identities (fka Shared Mailboxes)

## Core Insight

Email is one communication channel. A shared mailbox like `support@company.com`
should not be locked to email. It should be a full **team identity** — a
first-class participant across every modality Fuse offers.

`support@company.com` can:
- Send and receive **email** (traditional shared mailbox)
- Post and reply in **chat channels** (`#engineering`, `#announcements`)
- **Join meetings** (scheduled or ad-hoc)
- Be present in **voice channels**
- Author and comment on **documents**
- Have its own **presence, avatar, status**
- Be @mentioned by anyone in the org
- Have an **AI agent** that acts on its behalf
- Have **members** (human operators who "act as" the identity)

## What Outlook (and every other email client) Gets Wrong

| Feature | Outlook | Gmail | Intercom | Fuse |
|---------|---------|-------|----------|------|
| Shared mailbox reads/writes | ✓ | ✓ | ✓ | ✓ |
| Shared mailbox in group chat | | | | ✓ |
| Shared mailbox joins meetings | | | | ✓ |
| Shared mailbox sends channel messages | | | | ✓ |
| Internal notes on emails | ~ (mail tips) | ~ (confidential mode) | ✓ | ✓ |
| Turn email into task | ~ (add-on) | | ✓ | ✓ |
| AI drafts for shared mailbox | | ✓ (basic) | ✓ | ✓ |
| Cross-org shared mailbox | | | | ✓ |
| Shared mailbox in voice channels | | | | ✓ |
| Shared mailbox authors documents | | | | ✓ |
| SLA tracking | | | ✓ | ✓ |
| Macros / multi-step automation | ~ (VBA scripts) | ~ (Apps Script) | ✓ | ✓ |

## Concept: Team Identity

A **Team Identity** is an identity of type `shared` — named, backed by multiple
human members, and a full participant in the Fuse org. It has a canonical
`name@domain` key and can be added to any channel, meeting, or doc — just
like a `human` identity.

```
TeamIdentity
├── Email: support@company.com
├── Display: "Customer Support"
├── Avatar, status, presence
├── Member list (users who can act-as)
├── Channel memberships (#support, #engineering, #announcements)
├── Calendar (meetings it attends)
├── Document space (KB articles authored-by)
├── AI agent (acts on behalf of the identity)
└── Automation rules (inbound routing, triggers)
```

## Data Model

```
TeamIdentity {
  id: uuid
  org_id: uuid
  email: "support@company.com"
  display_name: "Customer Support"
  avatar: url | null
  status: {
    text: "Helping customers",
    emoji: "🎧",
    presence: "online" | "away" | "dnd"
  }
  signature: "Best regards,\nThe Support Team"
  alias: ["help@company.com", "hello@company.com"]

  // Automation
  routing: "round_robin" | "assign_to_all" | "manual"
  auto_respond: {
    enabled: boolean
    message_template: string
    delay_minutes: number
  }
  sla_config_id: uuid | null

  // AI
  ai_agent_enabled: boolean
  ai_instructions: string  // "Always respond politely..."

  created_at: timestamp
  updated_at: timestamp
}
```

### Membership & Roles

```
IdentityMember {
  identity_id: uuid
  user_id: uuid
  role: "owner" | "manager" | "agent" | "viewer"

  // Per-member preferences
  notify_on_email: "all" | "assigned_only" | "none"
  notify_on_channel_mention: boolean
  notify_on_meeting_invite: boolean
  signature_override: string | null

  joined_at: timestamp
}
```

| Role | Act-as | Read all | Reply | Assign | Manage rules | Add members | Delete identity |
|------|--------|----------|-------|--------|-------------|-------------|-----------------|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Agent | ✓ | ✓ | ✓ | ✓ | | | |
| Viewer | | ✓ | | | | | |

### Acting-As Flow

When a user acts as a team identity, everything they do is attributed to the
identity, not themselves:

```
Alice clicks "Act as support@"
  └── Every message she sends appears from support@
  └── Meetings she joins show support@ as participant
  └── Docs she edits show support@ as author
  └── Visual indicator: [A] → [S] avatar swap, name badge
  └── Audit log records: Alice acted as support@ at 14:32
```

Users can switch between their personal identity and any team identity they
have Agent+ access to, with a dropdown toggle in the UI.

### Multiple Concurrent Backers

Multiple users can act as the **same** shared identity simultaneously. This is
most visible in real-time contexts (voice channels, meetings, chat channels):

```
Voice channel: #customer-support-voice
├── support@ #1   (backing user: Alice)    ← Alice acting as support@
├── support@ #2   (backing user: Bob)      ← Bob acting as support@
└── support@ #3   (backing user: Carol)    ← Carol acting as support@
```

The display of concurrent backers is **configurable per identity**:

| Mode | Display | Use case |
|------|---------|----------|
| Numbered | `support@ #1`, `support@ #2` | Clean, hides personal identities |
| Personal tag | `support@ (Alice)`, `support@ (Bob)` | Transparency, who's actually speaking |
| Role-based | `support@ (L1 Support)`, `support@ (L2 Support)` | Functional differentiation |
| Hide-on-hover | Shows numbered by default, personal on hover | Best of both worlds |

This is set in the identity's display configuration. In cross-org contexts,
the receiving org sees whatever display mode the sending org configured
(identity type transparency applies — the receiving org can also apply its
own display policy, e.g., "always show personal backing for audit").

## Cross-Modality Participation

### Email (Traditional Shared Mailbox)

Other Fuse users email `support@company.com` normally. Email arrives, is
routed to the `#support-inbound` channel, and agents handle it.

Same as the previous spec: internal notes, doc attachments, email→channel
mirroring, etc.

### Chat Channels

`support@company.com` can be added to **any channel**, just like a person:

```
#engineering
├── Alice: "Hey support@, can you check if customers are reporting DB errors?"
├── support@: "Looking into it... we've had 3 reports in the last hour. Investigating."
└── support@: "Confirmed — it's a known issue, we'll notify affected customers."
```

- `support@` has presence in the channel member list
- Hovering shows which team members are currently backing the identity
- @mention `support@` notifies all agents currently acting-as
- `support@` can be muted, pinned, or messaged directly
- `support@` can initiate DMs with any user
- `support@` can create new channels
- `support@` can be the **owner** of channels (e.g., `#customer-feedback`)

### Meetings

`support@company.com` can be invited to meetings or schedule its own:

```
Meeting: "Customer Escalation Review"
Attendees:
├── Alice@company.com
├── Bob@partner.com
├── support@company.com  (currently backed by Carol)
└── AI Assistant

Meeting invite was sent to support@
→ All agents backing support@ get notified
→ Carol accepts on behalf of support@
→ Carol joins the meeting as "Customer Support" (name, avatar)
→ Other participants see "Customer Support" with display config applied
  (e.g., "support@ (Carol)" or "support@ #1" depending on identity settings)
→ If multiple agents join as support@, each appears as a separate instance
  → "support@ #1 (Carol)", "support@ #2 (Bob)"
  → Each has independent audio/video, mute, and camera controls
```

**AI Stand-in:** If no agent is available to back the identity in a meeting,
the AI agent can attend as a "listener-only" mode and provide a summary
afterward:

```
support@ joined the meeting via AI stand-in
  ├── Transcribed the full meeting
  ├── Identified action items: [Fix billing bug, Update docs]
  └── Posted summary to #customer-feedback channel
```

### Voice Channels

`support@` can be in persistent voice channels. Since shared identities can
have multiple concurrent backers, the voice channel shows each instance
according to the identity's display configuration:

```
🔊 #customer-support-voice
├── ── Member list ──
├── support@ #1  🎤 (backing user: Alice)
├── support@ #2  🔇 (backing user: Bob)
├── support@ #3  🎤 (backing user: Carol)
├── ─────────────
├── Alice@company.com (personally in channel, not acting-as)
└── ─────────────
```

- Customers or other channel participants see the configured display
  (numbered, personal-tagged, or role-based)
- Hovering over a numbered instance reveals the backing user
- Each backer has independent mute/volume controls
- Multiple backers can speak simultaneously (spatial audio separates them)
- If all backers leave, AI stand-in activates:
  "Thanks for calling, an agent will be with you shortly"
- The identity's display config is honored cross-org (receiving org sees
  what the sending org configured, unless overriding via policy)

### Documents

`support@` can author and edit documents:

```
📄 Support Playbook
├── Author: support@
├── Last edited by: support@ (Alice, 2 hours ago)
├── Comments: Alice (acting as support@): "Updated the escalation section"
└── Share with: support@, all@company.com
```

The identity has its own document space (`/docs/support`) for KB articles,
runbooks, and templates.

### Tasks

`support@` can be assigned tasks and can create tasks for others:

```
📋 Task: "Investigate DB error spike" #T-125
├── Created by: support@
├── Assigned to: Alice
├── Priority: P1
└── Linked to: #engineering message thread
```

Tasks linked to an identity show up in the identity's task board, which all
agents can see and manage.

### AI Agent

The identity has its own AI agent with identity-scoped memory:

```
AI Agent for support@
├── Knows: all emails sent/received by support@
├── Knows: all channel messages posted as support@
├── Knows: all docs authored/edited by support@
├── Knows: meeting transcripts where support@ attended
├── Remembers: "Customer Acme Corp has a premium SLA"
├── Remembers: "The refund limit is $500 without manager approval"
└── Acts: drafts replies, suggests macros, auto-tags, creates tasks
```

The AI agent can be configured with custom instructions for the identity:
"I work for Customer Support at Company. I am polite, professional, and
efficient. If I don't know an answer, I escalate to a human agent."

## Automation

All automation from the previous spec applies, plus:

### Cross-Modality Automation Rules

Rules can now trigger across any modality, not just email:

| Trigger | Source | Action |
|---------|--------|--------|
| Inbound email | support@ | Create task, notify agents |
| @mention in channel | #engineering | Create task, reply "Checking..." |
| Meeting scheduled | support@ calendar | Send prep doc to agents |
| SLA breach | support@ queue | Post warning in #support-internal |
| Customer tags identity | doc | Notify agent, send snippet |
| Voice channel join | #support-voice | Notify "customer waiting" in chat |
| New doc in KB | support@ space | Announce in #announcements |

### Example: Full Cross-Modality Workflow

```
1. Customer emails support@: "Urgent: Can't log in"
2. Fuse auto-creates P1 task, assigns to duty agent (Alice)
3. Email appears in #support-inbound channel as a thread
4. Alice is notified (push + channel @mention)
5. Alice acts as support@, joins the thread
6. Alice @mentions support@ AI: "Draft a response with password reset link"
7. AI drafts reply, Alice edits and sends
8. AI creates internal note: "Customer has reset password 3 times this month"
9. Alice schedules a follow-up meeting with engineering for next week
   → support@ appears as the meeting organizer
10. Customer replies: "Still can't log in, this is urgent"
    → Support@ AI flags SLA breach, posts to #support-internal
    → Alice escalates: creates a doc, @mentions engineering in #eng channel
    → Engineering responds in-thread, root cause found
11. Resolution posted, task closed, AI logs the root cause in KB
```

All of this happens without Alice ever leaving the Fuse interface, and the
customer only ever sees "support@company.com".

## Cross-Org Team Identities

When OrgA trusts OrgB at Level 3+, a team identity can span orgs:

- `partner-support@a.com` has members from both orgs
- Members from OrgB can act-as the identity
- Cross-org channels can include the identity
- Cross-org meetings can invite the identity
- The identity's AI agent has access to shared context from both orgs

## v1b Status

| Feature | Version |
|---------|---------|
| Team identity data model (roles, members, settings) | v1 |
| Email → channel mirroring | v1 |
| Internal notes on emails | v1 |
| Manual task creation from any modality | v1 |
| Task ↔ thread bidirectional linking | v1 |
| Canned responses / snippets | v1 |
| Identity presence in channels | v1 |
| Act-as switching (user to identity) | v1 |
| Identity DMs and channel membership | v1 |
| Identity in meetings (human-backed) | v2 |
| Identity in voice channels (human-backed) | v2 |
| Identity-authored docs | v2 |
| AI agent for identity | v2 |
| AI stand-in for meetings | v2 |
| Cross-modality automation rules | v2 |
| SLA tracking | v2 |
| Macros | v2 |
| Cross-org team identities | v2 |
| Statistics & reporting | v2 |
| Advanced routing (skill-based, round-robin) | v2 |
