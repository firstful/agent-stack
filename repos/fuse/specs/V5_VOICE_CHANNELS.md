# v5 — Voice/Video Channels

## Objective

Add persistent, open voice/video channels (like Discord) where users can come
and go freely. These are distinct from scheduled meetings (v3) — they're
always-on virtual spaces.

## Concept

A voice channel is a channel (in the v4 channel list) that has an always-open
audio/video room. Users join and leave at will. Multiple conversations can
happen simultaneously (via spatial audio or separate "stage" areas).

```
🔊 VOICE
  #water-cooler       — Persistent open chat, always on
  #standup-room       — Used for daily standups (busy during standup hours)
  #pair-programming   — Ad-hoc pairing, join when you need help
  #town-hall          — Large-audience broadcast (stadium mode)
```

## Channel Types (Voice)

| Type | Participants | Description |
|------|-------------|-------------|
| Open voice | Unlimited | Anyone in channel can speak (Discord-like) |
| Stage | Unlimited | Speakers on stage, audience listens |
| Quiet | 2-8 | Low-presence voice channel (ambient) |
| Watch party | Unlimited | Shared screen + audio (movie/stream) |

## Features

### Voice
- Crystal-clear audio (Opus codec, adaptive bitrate)
- Push-to-talk (configurable keybind)
- Voice activity detection (VAD) with adjustable sensitivity
- Per-user volume control
- Mute/deafen self
- Server-deafen (admin/moderator can mute a user)
- Spatial audio (optional, for multi-conversation rooms)
- Noise suppression (RNNoise or Krisp-like)
- Echo cancellation

### Video
- Optional webcam per participant
- Grid layout (up to 25 participants visible)
- Active speaker spotlight
- Screen share with audio
- Virtual backgrounds (with blur/ custom image)
- Spotlight/pin specific participant

### Stage Mode (Town Hall)
- Moderators are "speakers" — their audio/video is broadcast to all
- Audience is listen-only, can raise hand
- Audience can be promoted to speaker
- Q&A panel (text-based, feeds to speakers)
- Up to 10,000 viewers

### Persistent Channel State
- Voice channels stay "open" even when empty
- When someone joins, they connect and others get a notification
- Channel shows who's currently in voice (green dot + count)
- Users can set a voice channel as their "current location" in presence

## Cross-Org Voice

Trust Level 3+ allows cross-org voice channels:
- Shared #water-cooler between partner orgs
- Joint standup meetings
- Cross-org pair programming

## Implementation

Voice channel 1:1 with a LiveKit room:
- When a voice channel is created, Fuse creates a corresponding LiveKit room
- Users join via WebRTC (browser) or native app
- Fuse handles auth tokens for LiveKit room access
- Recording toggle available per session (saves to Fuse storage)
- Bot can join voice channel for transcription (AI Agent)

## v5 Does NOT Include

- Document store (v6)
- Major new protocol features (v5 is purely an application-layer feature
  on top of the existing v4 channel model)
