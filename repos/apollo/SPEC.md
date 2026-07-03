# Apollo — Specification

## Overview

Apollo is a real-time voice gateway for Hermes Agent. It bridges an Android push-to-talk app with a Hermes AI agent by providing STT (speech-to-text) and TTS (text-to-speech) processing. Apollo lives in the agent-stack as a container service, exposed via Cloudflare Tunnel, and authenticates requests via Cloudflare Access service tokens.

## Status

- **Phase**: Spec
- **Completion**: 0/5 deliverables
- **Last updated**: 2026-07-03

## Specification Index

| Document | Description |
|----------|-------------|
| [Overview](spec/overview.md) | System overview, functional goals, and non-goals |
| [Architecture](spec/architecture.md) | High-level architecture diagram and primary concepts |
| [API](spec/api.md) | WebSocket protocol, Hermes API integration, audio format |
| [Android](spec/android.md) | Android app spec: PTT UX, audio capture, playback |
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

### Phase 3 — Production Hardening (4/4)
- [ ] 10. **Session continuity** — Hermes X-Hermes-Session-Id via Apollo
- [ ] 11. **Client-side CF Access** — embedded service token in Android app
- [ ] 12. **Error handling** — network loss, audio errors, graceful degradation
- [ ] 13. **Observability** — OTEL traces on Apollo, structured logging

## Open Questions / Blockers

- Hermes API server internal URL and auth mechanism (host.containers.internal vs stack-net DNS)
- CF-Access service token IDs to embed in Android build config
- Whether Hermes API server runs inside agent-stack or needs separate wiring

## Notes

- Apollo makes NO outbound network calls except to Hermes API server (local network)
- All audio processing (STT/TTS) is local to the Apollo container
- Android app is the only first-party client; protocol is open for others
