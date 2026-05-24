# v4 — Instant Messaging + Channels

## Objective

Add real-time instant messaging with a Discord/Slack-inspired UX. This is the
primary daily-driver interface for most users. Email becomes just another
view over the same data.

## Key UX Insight

In Fuse, **email and chat are the same thing, filtered by modality.** The
inbox view shows "formal, long-form" messages. The channel view shows
"casual, real-time" messages. A user can switch between them freely.

- A message sent in a channel is a message. It's stored identically to an email.
- A channel is a mailing list with presence, typing indicators, and reactions.
- An email is a channel message with more structured metadata.
- Threads exist identically in both views.

## Channel Types

| Type | Description | Discovery |
|------|-------------|-----------|
| Public | Open to anyone in the org | Directory |
| Private | Invite-only | By invitation |
| Shared (DM) | 1:1 direct message | From user profile |
| Group | Small group chat (2-20) | Invite from existing member |
| Cross-org | Shared with external domain | Admin-approved |
| Voice | Persistent voice channel (v5) | Directory |
| Doc | Thread for a document (v6) | Auto-created |
| AI | Bot-agent channel | Auto-created per channel |

### Identity Type in Channels

Every channel member has an identity type badge visible next to their name:
- 👤 `human` — natural person
- 🤖 `agent` — AI bot/assistant
- 🏢 `shared` — team identity (multi-user)
- ⚙️ `service` — system integration
- 🚪 `guest` — limited external participant

Cross-org channel members see the type badge and can hover for details.
Channel moderators can set type-based mute/block policies within the channel.

## Core Chat Features

### Messages
- Rich text (markdown with extensions: @mentions, /commands, :emoji:, tables)
- Inline code blocks with syntax highlighting
- Image/video previews
- File attachments
- Threaded replies (nested, not Slack-style flat)
- Message editing (with edit history)
- Message deletion (soft-delete, with undo)
- Pinned messages
- Scheduled/delayed send

### Reactions
- Standard emoji reactions
- Custom emoji (org-level and per-channel)
- Reaction counts (show top 3, expand on hover)

### Presence
- Online / Away / Do Not Disturb / Invisible
- Custom status text + emoji
- Auto-away after configurable idle time
- "Active in channel X" for cross-org visibility

### Typing Indicators
- Shows avatar + name of who's typing
- Ellipsis animation
- Grouped: "Alice and 2 others are typing..."
- Respects privacy: can be disabled per-user

### Notifications
| Setting | Behavior |
|---------|----------|
| All messages | Notify on every message |
| @mentions only | Only direct @mentions |
| Threads only | Only thread replies |
| Muted | No notifications |

### Search
- Full-text search across all channels, DMs, and email
- Filters: channel, date range, sender, has:attachment, type:email/chat
- Results show context (surrounding messages)
- Saved searches

### Slash Commands

| Command | Action |
|---------|--------|
| `/schedule` | Create a meeting (kicks off AI scheduling) |
| `/poll` | Create a poll |
| `/remind` | Set a reminder for yourself or channel |
| `/todo` | Create a task |
| `/gif` | Search/insert GIF |
| `/shrug` | Insert ¯\_(ツ)_/¯ |
| `/ai` | Ask the channel AI agent a specific question |
| `/summarize` | Get AI summary of recent channel activity |
| `/email` | Convert a message thread to an email to specified recipients |
| `/call` | Start an instant voice/video call in channel |

### @Mentions
- `@alice` — mentions a specific user
- `@channel` — mentions all channel members (notification)
- `@everyone` — mentions every user in the org (admin-restricted)
- `@here` — mentions only currently online channel members
- `@ai` / `@bot` — invokes the channel AI agent in-thread

### Emoji
- Native emoji support (Unicode 16.0)
- Org custom emoji upload
- Shortcode autocomplete (`:ro` → `:rocket:`)
- Skin tone modifiers

## Channel Organization

### Categories (like Discord)
Channels are grouped into collapsible categories:
```
📢 ANNOUNCEMENTS
  #general
  #announcements
💻 ENGINEERING
  #frontend
  #backend
  #devops
🔊 VOICE (v5)
  #water-cooler
  #standup-room
📄 DOCS (v6)
  #wiki
  #onboarding
```

### Pins & Bookmarks
Each channel has a pinned section (important messages) and bookmarks (links to
docs, sites, tools — like Slack's channel bookmarks).

## Fluid Modality (Key Differentiator)

### Chat → Email
1. User types `/email bob@partner.com` in a channel (or right-clicks a thread)
2. Fuse prompts: "Send this thread as an email to Bob?"
3. User can edit subject, add recipients (CC/BCC)
4. Email is sent via SMTP. If Bob's server is Fuse, Bob sees it as a channel
   message. If Bob's on Gmail, Bob gets a normal email.
5. Replies from Bob come back as new messages in the original channel

### Chat → Meeting
1. User clicks "Turn into meeting" or types `/schedule now`
2. Channel gets meeting metadata (time, link, recording)
3. Channel members get notified as attendees
4. After meeting, chat continues; recording is a pinned message

### Email → Chat
1. A long email thread can be "promoted" to a channel
2. Fuse creates a new channel with all thread participants
3. Previous email content appears as chat history
4. Future messages default to chat mode

## Message Retention

| Setting | Description |
|---------|-------------|
| Forever | No automatic deletion |
| Time-based | Auto-delete after N days (default: unlimited) |
| Per-channel | Different retention per channel type |

## v4 Does NOT Include

- Voice/video channels (v5)
- Document store (v6)
- Note: AI chatbot exists in every channel (spec is separate)
