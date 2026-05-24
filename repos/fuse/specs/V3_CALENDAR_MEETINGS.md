# v3 — Calendar + Meetings

## Objective

Add calendar and video/audio meeting capabilities. A meeting in Fuse is just
a shared channel with a start/end time and a voice/video component. This makes
the "turn a chat into a meeting" flow trivial.

## Calendar Integration

### CalDAV Compatibility

Fuse exposes a CalDAV endpoint so that users can sync with:
- Apple Calendar
- Thunderbird Lightning
- Google Calendar (via bridge)
- Outlook (via bridge)

### Calendar Data Model

```
Calendar
├── Event
│   ├── Title, time, timezone
│   ├── Attendees (internal + external)
│   ├── RSVP status per attendee
│   ├── Meeting link (fuse://meeting/...)
│   ├── Attachments
│   ├── Notes / agenda (rich text block)
│   └── Recurrence rule (RRULE)
└── Shared calendar (team, org, cross-org)
```

### Fuse Meeting Protocol

A meeting is represented as a `MEETING` frame in the Fuse protocol:

```jsonc
{
  "type": "meeting",
  "meeting_id": "uuid",
  "channel_id": "uuid",     // optional — linked channel
  "title": "Sprint Review",
  "time": {
    "start": "2026-05-16T15:00:00Z",
    "end": "2026-05-16T16:00:00Z"
  },
  "attendees": [
    {"email": "alice@a.com", "rsvp": "accepted"},
    {"email": "bob@b.com", "rsvp": "pending"}
  ],
  "meeting_url": "fuse://meeting/uuid",
  "media": "audio" | "video" | "presentation"
}
```

### Fluid Modality: Chat → Meeting

Any group channel can be promoted to a meeting:
1. User clicks "Turn into meeting" in a channel
2. Fuse adds start/end time, generates a meeting link
3. All channel members become attendees (with RSVP)
4. Channel members get notified
5. After the meeting, the channel continues as normal chat

The meeting recording and transcript become searchable messages in the channel.

## Video/Audio Engine

### v3 Baseline

Use **LiveKit** (github.com/livekit/livekit) as the WebRTC/SFU backend:
- SFU (Selective Forwarding Unit) architecture
- Runs as a sidecar to the Fuse server
- Handles WebRTC negotiation, TURN, recording
- Fuse server provides room/auth tokens

LiveKit is chosen because:
- Self-hosted, AGPL, single binary
- Well-documented auth/webhook APIs
- Supports recording, simulcast, transcoding
- Handles 1000+ participants per room

### Meeting Features (v3)

| Feature | Description |
|---------|-------------|
| 1:1 calls | Direct from any user profile or email |
| Group calls | Up to 50 participants |
| Screen sharing | With presenter controls |
| Meeting recording | Stored as Fuse attachment, searchable |
| Transcript | Live captions + post-meeting transcript |
| Calendar sync | Two-way CalDAV sync |
| RSVP | Accept, maybe, decline + optional note |
| AI summarization | Bot joins, generates summary, posts to channel |
| Cross-org meetings | All meeting features work across trusted domains. Invites/RSVPs delivered via signed+encrypted webhook push (V2_FEDERATION.md). |

## Scheduling

### Scheduling Assistant

AI-powered scheduling:
1. User types "Schedule a meeting with Bob next week"
2. AI checks both parties' calendars (cross-org if permitted)
3. AI proposes time slots
4. User confirms, meeting is created and invitations sent

### Polls

For group scheduling, Fuse supports time polls (like Doodle):
- Proposer selects possible time windows
- Attendees vote on times
- Winning time auto-generates the event

## v3 Does NOT Include

- Persistent voice channels (v5)
- Document store (v6)
- Full real-time chat (v4)
