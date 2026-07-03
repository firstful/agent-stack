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
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
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

# ── Run store (async replay) ─────────────────────────────────

RECONNECT_TTL = 300.0  # seconds to keep completed runs for replay


@dataclass
class RunResult:
    """Accumulated result of a single Hermes PTT turn."""
    run_id: str
    session_id: str
    transcript: str
    reply_text: str
    audio_chunks: list[bytes] = field(default_factory=list)
    seq_start: int = 0          # seq of the first audio chunk
    seq_end: int = 0            # seq of the last audio chunk (exclusive)
    complete: bool = False      # True = TTS finished fully
    created_at: float = 0.0
    interrupted: bool = False


class RunStore:
    """Keeps completed/interrupted runs per session for async replay.

    Each session maps to its most recent *unconsumed* run.  Once a
    run has been fully delivered to a freshly-connected client it is
    evicted.  Old orphaned runs are purged by a background task.
    """

    def __init__(self, ttl: float = RECONNECT_TTL):
        self._runs: dict[str, RunResult] = {}   # session_id → RunResult
        self._consumed: set[str] = set()        # run_ids fully delivered
        self._ttl = ttl
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_background_cleanup(self):
        """Run periodic eviction of stale runs."""
        async def _clean():
            while True:
                await asyncio.sleep(self._ttl)
                now = time.monotonic()
                stale = [
                    sid for sid, r in self._runs.items()
                    if (now - r.created_at) > self._ttl
                ]
                for sid in stale:
                    self._runs.pop(sid, None)
                    self._consumed.discard(sid)

        self._cleanup_task = asyncio.create_task(_clean())

    def put(self, result: RunResult) -> None:
        self._runs[result.session_id] = result

    def get(self, session_id: str) -> Optional[RunResult]:
        return self._runs.get(session_id)

    def mark_consumed(self, session_id: str) -> None:
        if session_id in self._runs:
            self._consumed.add(self._runs[session_id].run_id)
            del self._runs[session_id]

    def __contains__(self, session_id: str) -> bool:
        return session_id in self._runs

    @property
    def pending_count(self) -> int:
        return len(self._runs)


run_store = RunStore()

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
    run_store.start_background_cleanup()
    logger.info("Apollo ready on %s:%s", HOST, PORT)
    yield
    if run_store._cleanup_task:
        run_store._cleanup_task.cancel()
    logger.info("Apollo shutting down")


app = FastAPI(title="Apollo Voice Gateway", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "stt_loaded": _stt_pipeline is not None,
        "tts_available": _tts_available,
        "hermes_api": HERMES_API_URL,
        "pending_replays": run_store.pending_count,
    }


# ── WebSocket PTT handler ─────────────────────────────────────

_outbound_seq: int = 0  # monotonically increasing seq for all connections


def next_seq() -> int:
    global _outbound_seq
    _outbound_seq += 1
    return _outbound_seq


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

    # Connection-scoped state for replay tracking
    conn_session_id: Optional[str] = None       # from reconnect handshake
    conn_last_seq: int = 0                       # last seq the client acked
    current_result: Optional[RunResult] = None   # run being accumulated

    async def send_json(msg: dict, *, seq: Optional[int] = None) -> None:
        """Send JSON with an auto-incrementing seq number."""
        if seq is None:
            seq = next_seq()
        msg["seq"] = seq
        try:
            await ws.send_json(msg)
        except Exception:
            pass

    async def send_bytes_with_seq(data: bytes) -> int:
        """Send binary audio and return its seq number."""
        seq = next_seq()
        try:
            await ws.send_bytes(data)
        except Exception:
            pass
        return seq

    async def _replay_run(result: RunResult) -> bool:
        """Replay an undelivered run to a freshly-connected client.

        Returns True if the run was fully delivered, False if
        interrupted partway.
        """
        nonlocal state, current_session_id
        logger.info("Replaying run %s for session %s", result.run_id, result.session_id)

        current_session_id = result.session_id

        await send_json({"type": "session_id", "id": result.session_id})
        await send_json({"type": "stt_transcript", "text": result.transcript})
        await send_json({"type": "processing", "step": "tts"})
        await send_json({"type": "tts_start", "text": result.reply_text})

        state = PTTState.TTS_STREAMING
        cancel_event.clear()

        # Replay all saved audio chunks in order
        for i, chunk in enumerate(result.audio_chunks):
            if cancel_event.is_set():
                # Client interrupted during replay — save partial state
                result.audio_chunks = result.audio_chunks[i:]
                result.seq_start = result.seq_start + i
                run_store.put(result)
                return False
            await send_bytes_with_seq(chunk)

        if not cancel_event.is_set():
            if result.complete:
                await send_json({"type": "tts_end"})
                run_store.mark_consumed(result.session_id)
                state = PTTState.IDLE
                return True
            else:
                # Run was incomplete (interrupted mid-TTS before disconnect)
                await send_json({"type": "tts_fallback", "text": result.reply_text})
                run_store.mark_consumed(result.session_id)
                state = PTTState.IDLE
                return True
        return False

    async def reset_state(*, save_run: bool = True):
        nonlocal state, current_run_id, audio_buffer, current_result
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
        current_result = None
        state = PTTState.IDLE
        cancel_event.clear()

    # ── Reconnect handshake ─────────────────────────────────

    # Peek at the first message — it may be a reconnect handshake.
    # No timeout: on a first-ever connection the client sends a
    # reconnect handshake within <1s, but on slower links (phone
    # via CF tunnel) it may take longer.  A timeout just causes
    # a race where the server gives up before the client speaks.
    replayed = False
    first_pending = None
    try:
        first_msg = await ws.receive()
    except WebSocketDisconnect:
        logger.info("Client disconnected during handshake")
        return

    if first_msg.get("type") == "websocket.receive" and "text" in first_msg:
        try:
            handshake = json.loads(first_msg["text"])
            if handshake.get("type") == "reconnect":
                conn_session_id = handshake.get("session_id", "")
                conn_last_seq = handshake.get("last_seq", 0)
                logger.info(
                    "Reconnect handshake: session=%s last_seq=%d",
                    conn_session_id, conn_last_seq,
                )
                # Check for undelivered run
                if conn_session_id and conn_session_id in run_store:
                    result = run_store.get(conn_session_id)
                    if result and result.created_at:
                        delivered = await _replay_run(result)
                        if delivered:
                            replayed = True
                            await send_json({
                                "type": "reconnect_done",
                                "replayed": True,
                                "complete": result.complete,
                            })
                        else:
                            await send_json({
                                "type": "reconnect_done",
                                "replayed": True,
                                "complete": False,
                                "interrupted": True,
                            })
                else:
                    await send_json({
                        "type": "reconnect_done",
                        "replayed": False,
                    })
            else:
                await send_json({
                    "type": "reconnect_done",
                    "replayed": False,
                })
                first_pending = first_msg
        except json.JSONDecodeError:
            await send_json({
                "type": "reconnect_done",
                "replayed": False,
            })
            first_pending = first_msg
    else:
        await send_json({
            "type": "reconnect_done",
            "replayed": False,
        })
        first_pending = first_msg

    # ── Main loop ───────────────────────────────────────────

    try:
        while True:
            if not replayed and first_pending is not None:
                message = first_pending
                first_pending = None
            else:
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

                        # Create a RunResult for this turn (for replay)
                        current_result = RunResult(
                            run_id=current_run_id or "",
                            session_id=current_session_id or "",
                            transcript=transcript,
                            reply_text=reply,
                            created_at=time.monotonic(),
                        )
                        # Save to store immediately (in case of crash)
                        if current_session_id:
                            run_store.put(current_result)

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
                                    seq = await send_bytes_with_seq(chunk)
                                    # Save audio chunk for replay
                                    if current_result is not None:
                                        current_result.audio_chunks.append(chunk)
                                        if current_result.seq_start == 0:
                                            current_result.seq_start = seq
                                        current_result.seq_end = seq + 1
                                        # Update store periodically
                                        if current_session_id:
                                            run_store.put(current_result)
                            except Exception as e:
                                logger.exception("TTS error")
                                await send_json({"type": "tts_fallback", "text": reply})
                                current_result = None
                        else:
                            await send_json({"type": "tts_fallback", "text": reply})
                            current_result = None

                        if cancel_event.is_set():
                            # Interrupted during TTS — mark as incomplete
                            if current_result is not None:
                                current_result.interrupted = True
                                current_result.complete = False
                                if current_session_id:
                                    run_store.put(current_result)
                                current_result = None
                            cancel_event.clear()
                            state = PTTState.IDLE
                            continue

                        # TTS completed successfully
                        if current_result is not None:
                            current_result.complete = True
                            if current_session_id:
                                run_store.put(current_result)
                            current_result = None

                        await send_json({"type": "tts_end"})
                        state = PTTState.IDLE

                    elif cmd_type == "interrupt":
                        logger.info("Interrupt received (state=%s, run=%s)", state, current_run_id)
                        # Save current run as interrupted for replay
                        if current_result is not None:
                            current_result.interrupted = True
                            current_result.complete = False
                            if current_session_id:
                                run_store.put(current_result)
                            current_result = None
                        await reset_state(save_run=False)
                        await send_json({"type": "interrupted", "run_id": current_run_id or ""})

                    elif cmd_type == "cancel":
                        audio_buffer.clear()
                        current_result = None
                        state = PTTState.IDLE

                    elif cmd_type == "ping":
                        await send_json({"type": "pong"})

                    elif cmd_type == "ack":
                        # Client acknowledges receipt of a seq number
                        ack_seq = cmd.get("seq", 0)
                        if conn_session_id and ack_seq > conn_last_seq:
                            conn_last_seq = ack_seq

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.exception("WebSocket error")
        try:
            await send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        # Save current result for replay before cleaning up
        if current_result is not None and current_session_id:
            current_result.complete = state == PTTState.IDLE and not cancel_event.is_set()
            current_result.interrupted = cancel_event.is_set()
            run_store.put(current_result)
        # Cancel everything
        cancel_event.set()
        if current_run_id and state in (PTTState.HERMES_RUNNING, PTTState.TTS_STREAMING):
            try:
                await hermes.stop_run(current_run_id)
            except Exception:
                pass
        for t in active_tasks:
            t.cancel()
        await hermes.close()
        logger.info(
            "Connection closed (session=%s, runs_in_store=%d)",
            current_session_id, run_store.pending_count,
        )


# ── Entry point ────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
