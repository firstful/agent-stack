# Talaria — Handoff

**Date:** 2026-07-05
**Status:** Refactored, modular architecture implemented

---

## What Is Talaria

Real-time voice PTT (Push-to-Talk) gateway for Hermes Agent. Android app → Cloudflare Tunnel → Talaria server (STT/TTS) → Hermes API.

---

## Architecture (Modular)

```
repos/talaria/
├── server.py                    # Main FastAPI server (278 lines)
├── src/
│   ├── core/                    # Core components
│   │   ├── types.py            # Type definitions (276 lines)
│   │   ├── state_machine.py    # PTT state machine (77 lines)
│   │   ├── connection.py       # WebSocket connection (228 lines)
│   │   ├── audio_buffer.py     # Audio buffer management (119 lines)
│   │   ├── replay_store.py     # Connection replay storage (121 lines)
│   │   └── audio_validator.py  # Input validation (206 lines)
│   ├── audio/                   # Audio processing
│   │   ├── stt.py              # Speech-to-text (143 lines)
│   │   └── tts.py              # Text-to-speech (180 lines)
│   ├── protocol/                # Protocol handling
│   │   └── websocket_server.py # WebSocket handler (298 lines)
│   └── services/                # External services
│       └── hermes_client.py    # Hermes API client (215 lines)
├── hermes_api_server.py        # Hermes API proxy (unused, 208 lines)
├── agent-stack.json            # Deployment config
├── requirements.txt            # Python dependencies
├── pyproject.toml             # Project configuration
├── mypy.ini                   # Type checking config
├── pyrightconfig.json         # Pyright config
├── Dockerfile                 # Container build
└── README.md                  # Documentation
```

---

## Components

### Core (src/core/)
- **types.py**: Type definitions, enums, validation utilities
- **state_machine.py**: PTT state machine with validated transitions
- **connection.py**: WebSocket connection lifecycle management
- **audio_buffer.py**: Bounded audio storage with size limits
- **replay_store.py**: In-memory run storage for connection replay
- **audio_validator.py**: Input validation and sanitization

### Audio (src/audio/)
- **stt.py**: Speech-to-text using faster-whisper
- **tts.py**: Text-to-speech using edge-tts

### Protocol (src/protocol/)
- **websocket_server.py**: WebSocket message handling and PTT protocol

### Services (src/services/)
- **hermes_client.py**: Hermes API client with retry logic

---

## Configuration

Environment variables:
- `HOST`: Server host (default: 0.0.0.0)
- `PORT`: Server port (default: 8321)
- `HERMES_API_URL`: Hermes API URL
- `HERMES_API_KEY`: Hermes API key (use {SECRETS.HERMES_API_KEY})
- `STT_MODEL`: STT model name (default: base)
- `TTS_VOICE`: TTS voice (default: en-US-ChristopherNeural)

---

## Deployment

```bash
# Build and deploy via agent-stack
./controller build talaria
./controller deploy talaria
```

---

## Key Design Decisions

1. **Modular Architecture**: Split monolithic server into focused modules
2. **Type Safety**: Comprehensive type annotations throughout
3. **Bounded Buffers**: Audio buffers have size limits to prevent OOM
4. **Input Validation**: All inputs validated before processing
5. **Connection Replay**: Support for resuming after disconnections

---

## Security

- Hardcoded API key replaced with {SECRETS.HERMES_API_KEY} pattern
- Input validation prevents injection attacks
- Sensitive data redacted in logs

---

## Testing

```bash
# Type checking
mypy src/
pyright src/

# Run tests (when implemented)
pytest tests/
```
