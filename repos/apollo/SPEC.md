# Apollo — Specification

## Overview

Apollo is a real-time voice gateway for Hermes Agent. It bridges an Android push-to-talk app with a Hermes AI agent by providing STT (speech-to-text) and TTS (text-to-speech) processing. Apollo lives in the agent-stack as a container service, exposed via Cloudflare Tunnel, and authenticates requests via Cloudflare Access service tokens.

## Status

- **Phase**: Spec
- **Completion**: 0/21 deliverables
- **Last updated**: 2026-07-04

## Specification Index

| Document | Description |
|----------|-------------|
| [Overview](spec/overview.md) | System overview, functional goals, and non-goals |
| [Architecture](spec/architecture.md) | High-level architecture diagram and primary concepts |
| [API](spec/api.md) | WebSocket protocol, Hermes API integration, audio format |
| [Android](spec/android.md) | Android app spec: PTT UX, audio capture, playback |
| [Android v2](spec/android-v2.md) | Multimodal v2: text chat, threads, settings, modality switching |
| [Deploy](spec/deploy.md) | agent-stack deployment, Cloudflare Access, slot-swap |

## Deliverables

### Phase 1 — Core Pipeline (5/5)
- [ ] 1. **Apollo agent-stack service** — agent-stack.json, Dockerfile, backlog
- [ ] 2. **STT pipeline** — faster-whisper local transcription on CPU
- [ ] 3. **TTS pipeline** — EdgeTTS with ffmpeg Opus conversion
- [ ] 4. **Hermes API client** — `/v1/runs` with SSE event streaming
- [ ] 5. **WebSocket PTT endpoint** — binary audio in, streamed audio out

### Phase 2 — Android App (4/4)
- [ ] 6. **PTT button UI** — Compose hold-to-talk with haptic feedback
- [ ] 7. **Audio capture** — AudioRecord with press-start/release-stop
- [ ] 8. **WebSocket client** — OkHttp WebSocket with CF-Access headers
- [ ] 9. **Audio playback** — Media3 ExoPlayer streaming with ring buffer

### Phase 3 — Production Hardening (5/5)
- [ ] 10. **Session continuity** — Hermes X-Hermes-Session-Id via Apollo
- [ ] 11. **Client-side CF Access** — embedded service token in Android app
- [ ] 12. **Async replay resilience** — WebSocket reconnect, RunStore, seq tracking, audio buffering
- [ ] 13. **Error handling** — network loss, audio errors, graceful degradation
- [ ] 14. **Observability** — OTEL traces on Apollo, structured logging

### Phase 4 — Multimodal v2 (7/7)

- [x] 15. **Chat controls + text mode** — TextField input, send via WebSocket, text/voice coexistence
- [x] 16. **Settings panel / navigation drawer** — Drawer with thread list, settings, connection management
- [x] 17. **Topics / threads** — Multiple conversation threads with local Room persistence
- [x] 18. **Seamless modality switching** — PTT → text mid-conversation, same Hermes session
- [x] 19. **Server protocol extensions** — text_input, switch_session, text_echo, thread-aware RunStore
- [x] 20. **Room database layer** — Thread + Message entities, DAOs, migrations
- [x] 21. **DataStore preferences** — User-configurable settings persisted locally

See: [Android v2 Spec](spec/android-v2.md), [Implementation Backlog](backlog-v2.md)

## Open Questions / Blockers

- Hermes API server internal URL and auth mechanism (host.containers.internal vs stack-net DNS)
- CF-Access service token IDs to embed in Android build config
- Whether Hermes API server runs inside agent-stack or needs separate wiring

## Notes

- Apollo makes NO outbound network calls except to Hermes API server (local network)
- All audio processing (STT/TTS) is local to the Apollo container
- Android app is the only first-party client; protocol is open for others
