# Talaria — Handoff

**Date:** 2026-07-03
**Author:** Hermes Agent (Reed's session)
**Status:** Deployed, functional, pending vault integration

---

## What Is Talaria

Real-time voice PTT (Push-to-Talk) gateway for Hermes Agent. Android app → Cloudflare Tunnel → Talaria server (STT/TTS) → Hermes API. Full-duplex audio pipeline allowing the operator (Reed) to speak to Hermes by holding a PTT button, hear the agent's spoken response, and barge-in mid-turn.

---

## Architecture

```
[Android Phone]
  │  PTT → AudioRecord (16kHz PCM) → Opus-encoded binary WS frames
  │  ← Opus/OGG audio frames ← ExoPlayer
  │
  ▼  wss://talaria.ffilt.us/v1/ptt (via Cloudflare Tunnel)
  │  Headers: CF-Access-Client-Id, CF-Access-Client-Secret
  │
[Cloudflare Edge]
  │  Validates service token (JWT) → cloudflared tunnel → slot-proxy
  │
  ▼  127.0.0.1:8321 (slot-proxy → Talaria container)
  │
[Talaria Container]  (port 8321, blue-green via agent-stack)
  │  1. Receive Opus → decode to PCM
  │  2. STT: faster-whisper (base model)
  │  3. POST /v1/runs → Hermes API Server
  │  4. SSE /v1/runs/{id}/events → accumulate reply text
  │  5. TTS: edge-tts → ffmpeg → Opus/OGG stream
  │  6. Stream Opus frames back via WebSocket
  │
  ▼  http://hermes--api:8642 (stack-net internal DNS)
[Hermes API Server] (port 8642, systemd service on host)
```

### Key Components

| Component | Tech | Location |
|-----------|------|----------|
| Talaria server | Python 3.12 + FastAPI | `repos/talaria/server.py` |
| Android app | Kotlin + Jetpack Compose | `repos/talaria/android/` |
| agent-stack config | JSON | `repos/talaria/agent-stack.json` |
| Container image | Dockerfile (multi-stage) | `repos/talaria/Dockerfile` |
| Spec docs | Markdown | `repos/talaria/spec/` |

---

## Current State

### ✅ Running & Functional

- **Hermes API Server** on port **8642** (⚠️ localhost-only, accessible via socat proxy on :8643)
- **Talaria container** (`talaria--a`) on port **4001** → 8321 with correct API key and URL
- **Hermes Gateway** on port 9119 — handles Telegram/long-polling chat (separate from API server)
- **socat proxy** (PID 865702) on port **8643** → forwards to `127.0.0.1:8642`

### 🔧 Changes Made (COMMITTED)

The following fixes have been committed in `04541c7c`:

| File | Change |
|------|--------|
| `server.py` | `HERMES_API_URL` changed from `http://hermes--api:8642` → `http://host.containers.internal:8643` (uses socat proxy since the API server binds to 127.0.0.1); SSE `stream_events` fixed for current API format (`event: message.delta` with delta field, `run.completed` instead of `done`) with backward compatibility |
| `agent-stack.json` | `HERMES_API_KEY` set to the actual vault key (no longer placeholder) |
| `spec/api.md` | Updated Hermes API URL and payload format |
| `SPEC.md` | Updated |

### 🆕 Untracked Files

| File | Purpose |
|------|---------|
| `hermes_api_server.py` | **Standalone Hermes API Server** — refactored copy of the API server logic. NOT in use. The real API server runs as part of the Hermes gateway process (spawned by `hermes gateway run --replace`). This file is experimental/unused. |

### 🔴 Docs Outdated (NEED UPDATING)

Many spec files still reference:
- Hermes API at port **9119** (should be **8642**)
- Payload with `messages` array (should be `input` string — Responses API format)
- No `Authorization` header in example payloads

---

## Environment & Secrets

### Hermes API Key

- Stored in: `/root/.hermes/.env` as `API_SERVER_KEY=<key>`
- Also in: `agent-stack.json` as `HERMES_API_KEY` (now correct, not placeholder)
- Stored in: **vault** (`vault--b`, port 4005) under key `HERMES_API_KEY` with scope `talaria`
- **socat proxy** on host port **8643** forwards to `127.0.0.1:8642` (workaround since API server binds localhost-only)
- Talaria container uses `HERMES_API_URL=http://host.containers.internal:8643`

### Cloudflare Access

- Tunnel ID: `ca308a1b-557a-4a18-9350-6eec27465bdf`
- Service token credentials hardcoded in `MainActivity.kt` on the Android side
- CF Access token in Hermes memory (not documented in repo)

### Env Vars (Talaria container)

| Var | Value | Source |
|-----|-------|--------|
| `HOST` | `0.0.0.0` | agent-stack.json |
| `PORT` | `8321` | agent-stack.json |
| `HERMES_API_URL` | `http://host.containers.internal:8643` | agent-stack.json (socat proxy to localhost API) |
| `HERMES_API_KEY` | `<vault key>` (actual key, not placeholder) | agent-stack.json |
| `STT_MODEL` | `base` | agent-stack.json |
| `LOG_LEVEL` | `info` | agent-stack.json |

> **Note:** `HERMES_API_KEY` in agent-stack.json now contains the actual vault key. The API key is also stored in vault (`vault--b`, port 4005) as `HERMES_API_KEY` with scope `talaria`.

> **Note on API URL:** The Hermes API server binds to `127.0.0.1:8642` (localhost-only), so it's unreachable from containers. A **socat proxy** runs on the host at port **8643** forwarding to `127.0.0.1:8642`. The Talaria container uses `host.containers.internal:8643` to reach it. This should be fixed by setting `API_SERVER_HOST=0.0.0.0` in the Hermes env and restarting the gateway when possible.

---

## Traffic Flow Detail

### External → Internal

```
Phone → wss://talaria.ffilt.us/v1/ptt
  → Cloudflare (validates CF-Access JWT)
  → cloudflared tunnel (ca308a1b-...)
  → slot-proxy (routes to talaria--slot{b}:8321 based on runtime/services.json)
  → Talaria container
```

### Internal (within stack-net)

```
Talaria container → http://hermes--api:8642/v1/runs (POST)
                → http://hermes--api:8642/v1/runs/{id}/events (GET, SSE)
                → http://hermes--api:8642/v1/runs/{id}/stop (POST, barge-in)
```

The Hermes API Server runs as a systemd service on the host (NOT in a container). It's spawned by `hermes gateway run --replace`, which starts both the gateway (port 9119) and the API server (port 8642).

---

## WebSocket Protocol

### Client → Server

| Type | Format | Description |
|------|--------|-------------|
| Binary | Opus/OGG frames | Audio recording during PTT |
| `ptt_end` | `{"type":"ptt_end"}` | User released PTT → process audio |
| `interrupt` | `{"type":"interrupt"}` | Barge-in — stop current TTS, start fresh recording |
| `cancel` | `{"type":"cancel"}` | Discard audio buffer, no processing |
| `ping` | `{"type":"ping"}` | Keepalive |
| `reconnect` | `{"type":"reconnect","session_id":"...","last_seq":N}` | Async replay handshake (sent first on WS open) |
| `ack` | `{"type":"ack","seq":N}` | Periodic delivery acknowledgment |

### Server → Client

| Type | Format | Description |
|------|--------|-------------|
| Binary | Opus/OGG frames | TTS audio response |
| `processing` | `{"type":"processing","step":"stt"|"thinking"|"tts"}` | Status updates |
| `stt_transcript` | `{"type":"stt_transcript","text":"..."}` | User's recognized speech |
| `tts_start` | `{"type":"tts_start","text":"..."}` | About to stream TTS audio |
| `tts_end` | `{"type":"tts_end"}` | TTS stream complete |
| `tts_fallback` | `{"type":"tts_fallback","text":"..."}` | TTS unavailable — display text |
| `session_id` | `{"type":"session_id","id":"..."}` | Hermes session for continuity |
| `interrupted` | `{"type":"interrupted","run_id":"..."}` | Barge-in acknowledged |
| `error` | `{"type":"error","message":"..."}` | Processing error |
| `reconnect_done` | `{"type":"reconnect_done","replayed":bool,...}` | Handshake response |

Every server message includes a monotonically increasing `seq` field.

---

## Key Design Decisions

1. **Port 8642 for API server** — The Hermes API server runs on 8642, NOT 9119. Port 9119 is the gateway (chat/messaging). Talaria must talk to 8642.

2. **Responses API format** — The API server expects `{"input": "..."}` (OpenAI Responses API) not `{"messages": [...]}` (Chat Completions API).

3. **Bearer auth** — Every request to the API server needs `Authorization: Bearer <API_SERVER_KEY>`. The key is generated from `/dev/urandom` base64.

4. **Raw PCM from phone, Opus to phone** — Asymmetric audio: phone sends raw PCM (zero encoding latency), server sends Opus (bandwidth saving).

5. **Async Replay (RunStore)** — Completed runs are stored in memory with audio chunks. If the WebSocket disconnects mid-TTS, the client can reconnect and resume playback where it left off (using session_id + seq numbers).

6. **Blue-green deployment** — Talaria uses agent-stack's built-in blue-green strategy. Zero-downtime deploys.

7. **Single consumer, hardcoded** — Everything is hardcoded for Reed. No multi-user support, no auth beyond CF-Access.

---

## Blockers & Known Issues

### 1. 🟢 Vault Running & Populated

The vault container (`vault--b`, port 4005, under user `reeds`) is running and the Hermes API key has been stored:

| Detail | Value |
|--------|-------|
| **Secret key** | `HERMES_API_KEY` |
| **Scope** | `talaria` |
| **Vault API** | `http://localhost:4005` (or via slot-proxy at `http://localhost:4000` with `Host: vault.ffilt.us`) |
| **Auth** | Bearer token `VAULT_PASSWORD` from `agent-stack.json` |
| **Encryption** | AES-256-GCM at rest |

**Still in `.env` as fallback:** `/root/.hermes/.env` still has `API_SERVER_KEY=GCA...` for backward compatibility until Talaria is wired to fetch from vault.

**To wire Talaria to vault:** Change `agent-stack.json` env var from:
```json
"HERMES_API_KEY": "talaria-api-key"
```
to:
```json
"HERMES_API_KEY": "{SECRETS.HERMES_API_KEY}"
```
The controller will resolve `{SECRETS.XXX}` patterns at deploy time via `GET /api/secrets/plain/talaria`.

### 2. 🟢 Agent-Stack Config Has Correct API Key (FIXED)

`agent-stack.json` now has the actual vault-stored API key. No longer a placeholder.

### 3. 🟡 Spec Docs Outdated

The files in `spec/` reference port 9119 and the old `messages` payload format. They need updating to reflect:
- API port: 8642
- Payload: `{"input": "..."}` 
- Auth: `Authorization: Bearer`
- Architecture diagram URL from 9119 → 8642

### ✅ Vault Populated

Hermes API key stored in vault (`vault--b`, port 4005, user `reeds`) as:

| Field | Value |
|-------|-------|
| **Key** | `HERMES_API_KEY` |
| **Scope** | `talaria` |
| **Encryption** | AES-256-GCM (vault handles encryption at rest) |
| **Auth** | Bearer token `VAULT_PASSWORD` (set in `agent-stack.json`) |

The key is also still in `/root/.hermes/.env` as a fallback until Talaria is wired to fetch secrets from vault at startup (see the controller's `fetchSecrets()` in `infra/lib/services.ts` for the pattern — it uses `{SECRETS.KEY}` interpolation in env vars).

To add the vault secret to Talaria's environment, update `agent-stack.json` to reference it:
```json
"HERMES_API_KEY": "{SECRETS.HERMES_API_KEY}"
```

The controller will resolve this at deploy time by calling `GET /api/secrets/plain/talaria` on vault with its `VAULT_TOKEN`.

### 4. 🟡 `.env` Was Previously Overwritten

The `/root/.hermes/.env` file was overwritten with the template version during earlier debugging. The important variables (`API_SERVER_KEY`, `API_SERVER_ENABLED`, `OPENCODE_GO_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.) were re-appended but the file is messy — template boilerplate interleaved with actual config.

### 6. 🟡 socat Proxy for API Server (Workaround)

The Hermes API server binds to `127.0.0.1:8642` (localhost-only), making it unreachable from containers. A **socat** process (PID 865702) on port **8643** forwards to it. The Talaria container uses `host.containers.internal:8643`.

**Proper fix:** Add `API_SERVER_HOST=0.0.0.0` to `/root/.hermes/.env` and restart the gateway (requires a shell outside the gateway process, e.g., via SSH or systemd).

### 5. 🟢 No Immediate Blockers for Operation

Despite the above, the system works. The API server responds to authenticated requests, the gateway runs, and Talaria code is ready for deployment.

---

## Git State

```
$ git log --oneline -5 (Talaria commits)
04541c7c fix(talaria): correct Hermes API URL and fix SSE event format     ← LATEST (committed)
cbf7b179 fix(talaria): remove 1s timeout on first WS message
e49a7c55 fix(talaria): add comprehensive device-side logging + crash handler
8b8607ef fix(talaria): relax edge-tts version constraint
ff83543d fix(talaria): add build.network=host for apt-get
8133a0d4 feat: Talaria — real-time PTT voice gateway for Hermes Agent

Working tree clean. Untracked: HANDOFF.md, hermes_api_server.py (stale copy)
```

---

## Running Locally (for testing)

```bash
# API server is running as part of gateway:
pgrep -af "hermes gateway"

# Test API:
curl http://localhost:8642/v1/runs -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep API_SERVER_KEY /root/.hermes/.env | cut -d= -f2)" \
  -d '{"input":"hello"}'

# Talaria server (in container):
# cd /srv/agent-stack && ./controller build talaria
# cd /srv/agent-stack && ./controller deploy talaria
```

---

## Next Steps (Priority Order)

~~1. **Commit the uncommitted changes** — `server.py`, `agent-stack.json`, `spec/api.md`, `SPEC.md`. DONE (`04541c7c`).~~

**1. Fix API server bind address** — The Hermes API server binds to `127.0.0.1:8642`, making it unreachable from containers. Current workaround: `socat` proxy on port 8643. Proper fix: add `API_SERVER_HOST=0.0.0.0` to `/root/.hermes/.env` and restart the gateway (requires separate shell, not from within the gateway process).

**2. Wire vault to agent-stack.json** — Change `agent-stack.json` env var from hardcoded value to `"HERMES_API_KEY": "{SECRETS.HERMES_API_KEY}"` so the controller resolves it at deploy time.

**3. Update spec docs fully** — All files in `spec/` need port and payload format corrections. The architecture diagram URL is wrong.

**4. Deploy Talaria via controller** — The controller's reconciliation should handle Talaria again once the slot marker is cleaned up. Or just continue running the manually-started container.

**5. Clean up `.env`** — `/root/.hermes/.env` has template content mixed with actual config. Consider trimming it to only the active variables.

**6. Remove `hermes_api_server.py`** — This untracked file is a stale experimental copy. It's not used and should be deleted or gitignored.

**7. Rebuild debug APK** — The existing APK was built before the latest server fix. While the Android app only connects via WebSocket (no server code), rebuilding ensures the APK matches the latest source.

---

## Key Commands

```bash
# Check API server
curl -s http://localhost:8642/health

# Restart gateway (picks up .env changes)
hermes gateway stop && hermes gateway

# Start a test run
curl -s http://localhost:8642/v1/runs -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep API_SERVER_KEY /root/.hermes/.env | cut -d= -f2)" \
  -d '{"input":"say hello in one word"}'

# Build & deploy Talaria
cd /srv/agent-stack && ./controller build talaria && ./controller deploy talaria

# View Talaria logs
podman logs -f talaria--slot-a  # or --slot-b
```
