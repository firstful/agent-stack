# Talaria — Backlog

## Overview

Real-time voice gateway for Hermes Agent. Android PTT app → Cloudflare Tunnel → Talaria (STT/TTS) → Hermes API Server. Full-duplex audio pipeline with push-to-talk.

## Architecture

```
[Android App] ──PTT audio──→ Cloudflare Tunnel (CF-Access auth)
    → slot-proxy → Talaria (STT → Hermes API → TTS)
    ← audio response ← Talaria ───────────────┘
```

## Deliverables

- [ ] 1. **Talaria agent-stack service**: Containerized Python FastAPI server
- [ ] 2. **STT pipeline**: faster-whisper local transcription
- [ ] 3. **TTS pipeline**: EdgeTTS / configurable provider
- [ ] 4. **Hermes API client**: `/v1/runs` + SSE event streaming
- [ ] 5. **WebSocket PTT endpoint**: Receive audio, stream back response audio
- [ ] 6. **Android app**: Kotlin/Jetpack Compose PTT button
- [ ] 7. **Cloudflare Access**: CF-Access-Client-Id/Secret headers on Android
- [ ] 8. **Deploy**: Blue-green slot swap via agent-stack controller

## Open Questions / Blockers

- Need Hermes API server URL and auth (service token or local network)
- CF-Access service token credentials to embed in Android app
- Hermes API server hostname/port (internal `hermes.ffilt.us` or `host.containers.internal`)

## Notes

- STT: faster-whisper with `base` model for low latency
- TTS: EdgeTTS (free, local, no API key) with ffmpeg for Opus conversion
- Audio format: Opus in OGG container (native Telegram/Android support)
- Android uses ExoPlayer/Media3 for streaming playback
- WebSocket protocol: binary audio frames, JSON control messages
- Hermes API uses `/v1/runs` with SSE for structured lifecycle events
