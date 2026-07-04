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
HERMES_API_URL = os.environ.get("HERMES_API_URL", "http://hermes--api:8642")
HERMES_API_KEY = os.environ.get("HERMES_API_KEY", "")
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
    thread_id: str = ""         # v2: thread id for thread-aware store
    is_text_input: bool = False # v2: True if this run came from text_input


class RunStore:
    """Keeps completed/interrupted runs per session+thread for async replay.

    Each (session_id, thread_id) pair maps to its most recent *unconsumed*
    run.  Once a run has been fully delivered to a freshly-connected client
    it is evicted.  Old orphaned runs are purged by a background task.

    For backward compatibility with v1 clients (no thread_id), the thread_id
    defaults to empty string, effectively keying by session_id alone.
    """

    def __init__(self, ttl: float = RECONNECT_TTL):
        self._runs: dict[tuple[str, str], RunResult] = {}   # (session_id, thread_id) → RunResult
        self._consumed: set[str] = set()                     # run_ids fully delivered
        self._ttl = ttl
        self._cleanup_task: Optional[asyncio.Task] = None

    @staticmethod
    def _make_key(session_id: str, thread_id: str = "") -> tuple[str, str]:
        return (session_id, thread_id)

    def start_background_cleanup(self):
        """Run periodic eviction of stale runs."""
        async def _clean():
            while True:
                await asyncio.sleep(self._ttl)
                now = time.monotonic()
                stale = [
                    key for key, r in self._runs.items()
                    if (now - r.created_at) > self._ttl
                ]
                for key in stale:
                    run_id = self._runs[key].run_id
                    self._runs.pop(key, None)
                    self._consumed.discard(run_id)

        self._cleanup_task = asyncio.create_task(_clean())

    def put(self, result: RunResult) -> None:
        key = self._make_key(result.session_id, result.thread_id)
        self._runs[key] = result

    def get(self, session_id: str, thread_id: str = "") -> Optional[RunResult]:
        return self._runs.get(self._make_key(session_id, thread_id))

    def mark_consumed(self, session_id: str, thread_id: str = "") -> None:
        key = self._make_key(session_id, thread_id)
        if key in self._runs:
            self._consumed.add(self._runs[key].run_id)
            del self._runs[key]

    def __contains__(self, key) -> bool:
        """Supports both str (v1: session_id) and tuple (v2: (session_id, thread_id))."""
        if isinstance(key, str):
            key = self._make_key(key)
        return key in self._runs

    @property
    def pending_count(self) -> int:
        return len(self._runs)


run_store = RunStore()

# ── Lazy-loaded globals ───────────────────────────────────────

_stt_pipeline = None
_tts_available = False
_stt_init_lock = asyncio.Lock()
_tts_init_done = False
_background_init_task: Optional[asyncio.Task] = None


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
    async with _stt_init_lock:
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
    global _tts_available, _tts_init_done
    if _tts_init_done:
        return
    _tts_init_done = True
    try:
        import edge_tts
        voices = await edge_tts.list_voices()
        _tts_available = len(voices) > 0
        logger.info("Edge TTS available: %s voices", len(voices))
    except ImportError:
        logger.warning("edge-tts not installed")
        _tts_available = False


async def _background_load_models():
    """Load STT + TTS in background so HTTP/WS serving is not blocked."""
    logger.info("Background model loading started")
    await init_stt()
    await init_tts()
    logger.info("Background model loading complete")


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

    def __init__(self, base_url: str, api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self.client = httpx.AsyncClient(timeout=120.0, headers=headers)

    async def start_run(self, text: str, session_id: Optional[str] = None) -> dict:
        """POST /v1/runs — returns {run_id, session_id, status}."""
        payload = {
            "input": text,
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
        Cancels when cancel_event is set.

        Handles both legacy format (``type`` + ``content.text`` + ``done``)
        and current format (``event`` + ``delta`` + ``run.completed``).
        """
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

                # Current format: {"event": "message.delta", "delta": "..."}
                ev = data.get("event", "")
                if ev == "message.delta":
                    reply_text += data.get("delta", "")
                elif ev == "run.completed" or ev == "done":
                    break
                elif ev == "error":
                    raise RuntimeError(f"Hermes error: {data.get('message', '')}")

                # Legacy fallback: {"type": "message"|"delta", "content": {"text": "..."}}
                ev_type = data.get("type", "")
                if ev_type in ("message", "delta"):
                    content = data.get("content", {})
                    if content.get("type") == "text":
                        reply_text += content.get("text", "")

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
    global _background_init_task
    logger.info("Apollo starting up...")
    # Background-load STT/TTS models — server serves requests immediately
    _background_init_task = asyncio.create_task(_background_load_models())
    run_store.start_background_cleanup()
    logger.info("Apollo ready on %s:%s (models loading in background)", HOST, PORT)
    yield
    if _background_init_task and not _background_init_task.done():
        _background_init_task.cancel()
        try:
            await _background_init_task
        except asyncio.CancelledError:
            pass
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

    hermes = HermesClient(HERMES_API_URL, HERMES_API_KEY)
    state = PTTState.IDLE
    audio_buffer: list[bytes] = []
    current_run_id: Optional[str] = None
    current_session_id: Optional[str] = None  # last *completed* turn session
    cancel_event = asyncio.Event()
    active_tasks: list[asyncio.Task] = []

    # Connection-scoped state for replay tracking
    conn_session_id: Optional[str] = None       # from reconnect handshake
    conn_thread_id: Optional[str] = None         # v2: thread_id from reconnect
    conn_last_seq: int = 0                       # last seq the client acked
    current_result: Optional[RunResult] = None   # run being accumulated

    # Audio status tracking
    pending_client_msg_id: str = ""              # client_message_id from ptt_start

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
        logger.info("Replaying run %s for session %s (thread=%s)",
                    result.run_id, result.session_id, result.thread_id)

        current_session_id = result.session_id

        # v2: include thread_id if present
        session_msg: dict = {"type": "session_id", "id": result.session_id}
        if result.thread_id:
            session_msg["thread_id"] = result.thread_id
        await send_json(session_msg)

        # v2: text-mode runs use text_echo, voice runs use stt_transcript
        if result.is_text_input:
            await send_json({"type": "text_echo", "text": result.transcript})
            # Text runs: skip audio, just send tts_fallback
            await send_json({"type": "tts_fallback", "text": result.reply_text})
            run_store.mark_consumed(result.session_id, result.thread_id)
            state = PTTState.IDLE
            return True

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
                run_store.mark_consumed(result.session_id, result.thread_id)
                state = PTTState.IDLE
                return True
            else:
                # Run was incomplete (interrupted mid-TTS before disconnect)
                await send_json({"type": "tts_fallback", "text": result.reply_text})
                run_store.mark_consumed(result.session_id, result.thread_id)
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
                conn_thread_id = handshake.get("thread_id", "")  # v2
                conn_last_seq = handshake.get("last_seq", 0)
                logger.info(
                    "Reconnect handshake: session=%s thread=%s last_seq=%d",
                    conn_session_id, conn_thread_id, conn_last_seq,
                )
                # Check for undelivered run (v2: include thread_id in lookup)
                lookup_key = (conn_session_id, conn_thread_id) if conn_thread_id else conn_session_id
                if conn_session_id and lookup_key in run_store:
                    result = run_store.get(conn_session_id, conn_thread_id or "")
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

                    if cmd_type == "ptt_start":
                        # Client announces audio recording start with metadata
                        client_msg_id = cmd.get("client_message_id")
                        if client_msg_id:
                            pending_client_msg_id = client_msg_id
                            # Echo back immediately so client can update SENDING→SENT
                            await send_json({
                                "type": "ptt_start_echo",
                                "client_message_id": client_msg_id,
                            })
                        continue

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

                        await send_json({
                            "type": "stt_transcript",
                            "text": transcript,
                            "client_message_id": pending_client_msg_id or "",
                        })
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

                    # ── v2: text_input ──────────────────────────
                    elif cmd_type == "text_input":
                        if state != PTTState.IDLE:
                            await send_json({
                                "type": "error",
                                "message": "Session busy — agent is processing",
                            })
                            continue

                        text = cmd.get("text", "").strip()
                        if not text:
                            await send_json({"type": "error", "message": "Empty text input"})
                            continue

                        thread_id = cmd.get("thread_id", "")
                        session_id = cmd.get("session_id", "") or current_session_id

                        logger.info(
                            "text_input: session=%s thread=%s text=%.100s",
                            session_id, thread_id, text,
                        )

                        # Echo the text back with client_message_id for status tracking
                        echo_msg = {
                            "type": "text_echo",
                            "text": text,
                        }
                        client_msg_id = cmd.get("client_message_id")
                        if client_msg_id:
                            echo_msg["client_message_id"] = client_msg_id
                        await send_json(echo_msg)

                        await send_json({"type": "processing", "step": "thinking"})

                        # Send to Hermes
                        state = PTTState.HERMES_RUNNING
                        cancel_event.clear()
                        try:
                            result = await hermes.start_run(text, session_id=session_id)
                            current_run_id = result.get("run_id")
                            sess = result.get("session_id")
                            if sess:
                                current_session_id = sess
                                await send_json({
                                    "type": "session_id",
                                    "id": sess,
                                    "thread_id": thread_id,
                                })
                        except Exception as e:
                            logger.exception("Hermes start_run failed (text_input)")
                            await send_json({
                                "type": "error",
                                "message": f"Hermes API error: {e}",
                            })
                            state = PTTState.IDLE
                            continue

                        # Stream events
                        try:
                            reply = await hermes.stream_events(current_run_id, cancel_event)
                        except Exception as e:
                            logger.exception("Hermes stream_events failed (text_input)")
                            await send_json({
                                "type": "error",
                                "message": f"Agent error: {e}",
                            })
                            state = PTTState.IDLE
                            continue

                        # If interrupted mid-stream, bail
                        if cancel_event.is_set():
                            state = PTTState.IDLE
                            cancel_event.clear()
                            continue

                        if not reply:
                            await send_json({"type": "error", "message": "Empty response"})
                            state = PTTState.IDLE
                            continue

                        # Create RunResult for replay (text mode — no audio)
                        current_result = RunResult(
                            run_id=current_run_id or "",
                            session_id=current_session_id or "",
                            transcript=text,
                            reply_text=reply,
                            created_at=time.monotonic(),
                            thread_id=thread_id,
                            is_text_input=True,
                        )
                        if current_session_id:
                            run_store.put(current_result)

                        # Text inputs: skip TTS, send tts_fallback
                        await send_json({
                            "type": "tts_fallback",
                            "text": reply,
                        })

                        # Mark as complete
                        if current_result is not None:
                            current_result.complete = True
                            if current_session_id:
                                run_store.put(current_result)
                            current_result = None

                        state = PTTState.IDLE

                    # ── v2: switch_session ──────────────────────
                    elif cmd_type == "switch_session":
                        new_session_id = cmd.get("session_id", "")
                        new_thread_id = cmd.get("thread_id", "")

                        logger.info(
                            "switch_session: session=%s thread=%s",
                            new_session_id, new_thread_id,
                        )

                        if new_session_id:
                            current_session_id = new_session_id
                        if new_thread_id:
                            conn_thread_id = new_thread_id

                        await send_json({
                            "type": "session_switched",
                            "session_id": current_session_id or "",
                            "thread_id": conn_thread_id or "",
                        })

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
    import uvicorn

    # Configure logging AFTER uvicorn import (uvicorn overrides root logger
    # on import, not just on run), but BEFORE uvicorn.run so our handler
    # takes effect for app-level loggers.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        force=True,  # Override uvicorn's root logger config
    )
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
