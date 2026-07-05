# Talaria — Specification

## Overview

Talaria is a real-time voice PTT (Push-to-Talk) gateway for Hermes Agent. It handles WebSocket connections from Android clients for voice interactions with AI agents.

## Protocol

### WebSocket Messages

#### Client → Server
- `ptt_start`: PTT button pressed
- `ptt_end`: PTT button released
- `interrupt`: Barge-in mid-turn
- `cancel`: Cancel current operation
- `ping`: Keepalive
- `ack`: Acknowledge receipt of sequence number
- `text_input`: Text input (v2)
- `switch_session`: Switch session

#### Server → Client
- `ptt_start_echo`: PTT start acknowledged
- `processing`: Status update (stt, thinking, tts)
- `stt_transcript`: Speech-to-text result
- `tts_start`: TTS streaming started
- `tts_end`: TTS streaming completed
- `tts_fallback`: Text fallback for unavailable TTS
- `session_id`: Hermes session identifier
- `error`: Error occurred
- `interrupted`: Barge-in acknowledged
- `pong`: Ping response
- `reconnect_done`: Reconnection completed
- `session_switched`: Session switch event

### Binary Messages
- Audio data: Opus-encoded audio chunks

## State Machine

```
IDLE → RECORDING → TRANSCRIBING → HERMES_RUNNING → TTS_STREAMING → IDLE
                                        ↓
                                    INTERRUPTED → IDLE
```

## Configuration

- `HOST`: Server host (default: 0.0.0.0)
- `PORT`: Server port (default: 8321)
- `HERMES_API_URL`: Hermes API URL
- `HERMES_API_KEY`: Hermes API key
- `STT_MODEL`: STT model name (default: base)
- `TTS_VOICE`: TTS voice (default: en-US-ChristopherNeural)
- `MAX_AUDIO_CHUNK_SIZE`: Max audio chunk size (default: 5MB)
- `MAX_AUDIO_BUFFER_SIZE`: Max audio buffer size (default: 50MB)

## API

### Health Check
```
GET /health
Response: { status, stt_loaded, tts_available, hermes_api, pending_replays }
```

### WebSocket PTT
```
WS /v1/ptt
```
