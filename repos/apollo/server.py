"""Apollo — Real-time voice gateway for Hermes Agent.

Single-consumer (Reed), hardcoded for the homelab.
WebSocket PTT protocol: binary Opus in, binary Opus + JSON events out.
Supports barge-in: pressing PTT mid-turn interrupts the agent.
"""

import asyncio
import json
import logging
import os
import subprocess
import uuid
from contextlib import asynccontextmanager
from enum import Enum, auto
from pathlib import Path
from typing import AsyncIterator, Optional

import httpx
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logger = logging.getLogger("apollo")

# ── Hardcoded config (single consumer) ────────────────────────

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8321"))
HERMES_API_URL = os.environ.get("HERMES_API_URL", "http://hermes--api:9119")
STT_MODEL_SIZE = os.environ.get("STT_MODEL", "base")
CACHE_DIR = Path("/app/cache")
AUDIO_SAMPLE_RATE = 16000
OPUS_BITRATE = "24k"

CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ── Lazy-loaded globals ───────────────────────────────────────

_stt_pipeline = None
_tts_available = False


# ── State machine ─────────────────────────────────────────────

class PTTState(Enum):
    IDLE = auto()
    RECORDING = auto()
    TRANSCRIBING = auto()
    HERMES_RUNNING = auto()
    TTS_STREAMING = auto()
    INTERRUPTED = auto()


# ── STT: faster-whisper ──────────────────────────────────────

async def init_stt():
    global _stt_pipeline
    if _stt_pipeline is not None:
        return
    logger.info("Loading faster-whisper model: %s", STT_MODEL_SIZE)
    loop = asyncio.get_event_loop()

    def _load():
        from faster_whisper import WhisperModel
        return WhisperModel(STT_MODEL_SIZE, device="cpu", compute_type="int8")

    _stt_pipeline = await loop.run_in_executor(None, _load)
    logger.info("STT model loaded: %s", STT_MODEL_SIZE)


async def transcribe(audio_bytes: bytes) -> str:
    """Transcribe raw PCM s16le 16kHz mono to text."""
    global _stt_pipeline
    if _stt_pipeline is None:
        await init_stt()

    loop = asyncio.get_event_loop()
    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    def _run():
        segments, _ = _stt_pipeline.transcribe(audio_array, beam_size=5)
        return " ".join(seg.text for seg in segments).strip()

    return await loop.run_in_executor(None, _run)


# ── TTS: Edge TTS ────────────────────────────────────────────

async def init_tts():
    global _tts_available
    try:
        import edge_tts
        voices = await edge_tts.list_voices()
        _tts_available = len(voices) > 0
        logger.info("Edge TTS available: %s voices", len(voices))
    except ImportError:
        logger.warning("edge-tts not installed")
        _tts_available = False


async def synthesize(text: str, voice: str = "en-US-ChristopherNeural",
                     cancel_event: Optional[asyncio.Event] = None) -> AsyncIterator[bytes]:
    """Stream TTS audio as Opus chunks. Checks cancel_event between chunks."""
    import edge_tts

    communicate = edge_tts.Communicate(text, voice=voice)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-i", "pipe:0",
        "-acodec", "libopus",
        "-ac", "1",
        "-ar", str(AUDIO_SAMPLE_RATE),
        "-b:a", OPUS_BITRATE,
        "-f", "opus",
        "-page_duration", "20000",
        "pipe:1",
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    async def feed_tts():
        buffer = b""
        async for chunk in communicate.stream():
            if cancel_event and cancel_event.is_set():
                break
            if chunk["type"] == "audio":
                buffer += chunk["data"]
        if buffer and not (cancel_event and cancel_event.is_set()):
            proc.stdin.write(buffer)
        proc.stdin.close()

    feed_task = asyncio.create_task(feed_tts())

    try:
        while True:
            if cancel_event and cancel_event.is_set():
                proc.kill()
                break
            chunk = await asyncio.wait_for(proc.stdout.read(4096), timeout=0.5)
            if not chunk:
                break
            yield chunk
        await proc.wait()
    except asyncio.TimeoutError:
        pass  # normal — no data yet, continue loop
    except Exception:
        proc.kill()
    finally:
        feed_task.cancel()
        try:
            await feed_task
        except asyncio.CancelledError:
            pass


# ── Hermes API client ─────────────────────────────────────────

class HermesClient:
    """Client for Hermes API Server /v1/runs + /v1/runs/{id}/stop."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=120.0)

    async def start_run(self, text: str, session_id: Optional[str] = None) -> dict:
        """POST /v1/runs — returns {run_id, session_id, status}."""
        payload = {
            "messages": [{"role": "user", "content": text}],
            "stream": True,
        }
        if session_id:
            payload["session_id"] = session_id

        logger.info("Hermes POST /v1/runs: %s", text[:100])
        resp = await self.client.post(f"{self.base_url}/v1/runs", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def stream_events(self, run_id: str, cancel_event: asyncio.Event) -> str:
        """GET /v1/runs/{run_id}/events — SSE. Returns accumulated reply text.
        Cancels when cancel_event is set."""
        reply_text = ""

        async with self.client.stream(
            "GET", f"{self.base_url}/v1/runs/{run_id}/events",
        ) as event_stream:
            async for line in event_stream.aiter_lines():
                if cancel_event.is_set():
                    break
                if not line.startswith("data: "):
                    continue
                data = json.loads(line[6:])
                ev_type = data.get("type", "")
                if ev_type in ("message", "delta"):
                    content = data.get("content", {})
                    if content.get("type") == "text":
                        reply_text += content.get("text", "")
                elif ev_type == "done":
                    break
                elif ev_type == "error":
                    raise RuntimeError(f"Hermes error: {data.get('message', '')}")

        return reply_text

    async def stop_run(self, run_id: str) -> None:
        """POST /v1/runs/{run_id}/stop — interrupt a running agent."""
        try:
            logger.info("Hermes POST stop: %s", run_id)
            await self.client.post(f"{self.base_url}/v1/runs/{run_id}/stop")
        except Exception as e:
            logger.warning("Stop run failed (non-fatal): %s", e)

    async def close(self):
        await self.client.aclose()


# ── FastAPI app ───────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Apollo starting up...")
    await init_stt()
    await init_tts()
    logger.info("Apollo ready on %s:%s", HOST, PORT)
    yield
    logger.info("Apollo shutting down")


app = FastAPI(title="Apollo Voice Gateway", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "stt_loaded": _stt_pipeline is not None,
        "tts_available": _tts_available,
        "hermes_api": HERMES_API_URL,
    }


# ── WebSocket PTT handler ─────────────────────────────────────

@app.websocket("/v1/ptt")
async def ptt_websocket(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket connected")

    hermes = HermesClient(HERMES_API_URL)
    state = PTTState.IDLE
    audio_buffer: list[bytes] = []
    current_run_id: Optional[str] = None
    current_session_id: Optional[str] = None  # last *completed* turn session
    cancel_event = asyncio.Event()
    active_tasks: list[asyncio.Task] = []

    async def send_json(msg: dict):
        try:
            await ws.send_json(msg)
        except Exception:
            pass

    async def reset_state():
        nonlocal state, current_run_id, audio_buffer
        cancel_event.set()
        # Abort Hermes run if active
        if current_run_id and state in (PTTState.HERMES_RUNNING, PTTState.TTS_STREAMING):
            await hermes.stop_run(current_run_id)
        # Cancel any background tasks
        for t in active_tasks:
            t.cancel()
        active_tasks.clear()
        audio_buffer.clear()
        current_run_id = None
        state = PTTState.IDLE
        cancel_event.clear()

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.disconnect":
                break

            if message["type"] == "websocket.receive":
                # ── Binary: audio data ──
                if "bytes" in message:
                    if state == PTTState.IDLE:
                        state = PTTState.RECORDING
                    if state == PTTState.RECORDING:
                        audio_buffer.append(message["bytes"])

                # ── Text: control message ──
                elif "text" in message:
                    try:
                        cmd = json.loads(message["text"])
                    except json.JSONDecodeError:
                        continue

                    cmd_type = cmd.get("type", "")

                    if cmd_type == "ptt_end":
                        if state != PTTState.RECORDING:
                            continue
                        state = PTTState.TRANSCRIBING

                        # Ensure we have enough audio
                        all_audio = b"".join(audio_buffer)
                        audio_buffer.clear()
                        if len(all_audio) < 4096:
                            await send_json({"type": "error", "message": "Audio too short"})
                            state = PTTState.IDLE
                            continue

                        await send_json({"type": "processing", "step": "stt"})

                        # Raw PCM s16le 16kHz mono — feed directly to whisper
                        pcm = all_audio
                        if not pcm:
                            await send_json({"type": "error", "message": "Audio decode failed"})
                            state = PTTState.IDLE
                            continue

                        # Transcribe
                        cancel_event.clear()
                        transcript = await transcribe(pcm)
                        if not transcript:
                            await send_json({"type": "error", "message": "No speech detected"})
                            state = PTTState.IDLE
                            continue

                        await send_json({"type": "stt_transcript", "text": transcript})
                        await send_json({"type": "processing", "step": "thinking"})

                        # Send to Hermes
                        state = PTTState.HERMES_RUNNING
                        cancel_event.clear()
                        try:
                            result = await hermes.start_run(transcript, session_id=current_session_id)
                            current_run_id = result.get("run_id")
                            sess = result.get("session_id")
                            if sess:
                                current_session_id = sess
                                await send_json({"type": "session_id", "id": sess})
                        except Exception as e:
                            logger.exception("Hermes start_run failed")
                            await send_json({"type": "error", "message": f"Hermes API error: {e}"})
                            state = PTTState.IDLE
                            continue

                        # Stream events
                        try:
                            reply = await hermes.stream_events(current_run_id, cancel_event)
                        except Exception as e:
                            logger.exception("Hermes stream_events failed")
                            await send_json({"type": "error", "message": f"Agent error: {e}"})
                            state = PTTState.IDLE
                            continue

                        # If we were interrupted, don't send TTS
                        if cancel_event.is_set():
                            state = PTTState.IDLE
                            cancel_event.clear()
                            continue

                        if not reply:
                            await send_json({"type": "error", "message": "Empty response"})
                            state = PTTState.IDLE
                            continue

                        # TTS
                        await send_json({"type": "processing", "step": "tts"})
                        await send_json({"type": "tts_start", "text": reply})

                        state = PTTState.TTS_STREAMING
                        cancel_event.clear()

                        if _tts_available:
                            try:
                                async for chunk in synthesize(reply, cancel_event=cancel_event):
                                    if cancel_event.is_set():
                                        break
                                    await ws.send_bytes(chunk)
                            except Exception as e:
                                logger.exception("TTS error")
                                await send_json({"type": "tts_fallback", "text": reply})
                        else:
                            await send_json({"type": "tts_fallback", "text": reply})

                        if cancel_event.is_set():
                            # Interrupted during TTS — don't send tts_end
                            cancel_event.clear()
                            state = PTTState.IDLE
                            continue

                        await send_json({"type": "tts_end"})
                        state = PTTState.IDLE

                    elif cmd_type == "interrupt":
                        logger.info("Interrupt received (state=%s, run=%s)", state, current_run_id)
                        await reset_state()
                        await send_json({"type": "interrupted", "run_id": current_run_id or ""})

                    elif cmd_type == "cancel":
                        audio_buffer.clear()
                        state = PTTState.IDLE

                    elif cmd_type == "ping":
                        await send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.exception("WebSocket error")
        try:
            await send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        await reset_state()
        await hermes.close()


# ── Entry point ────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
