"""
WebSocket protocol handler for Talaria PTT gateway.

This module handles the WebSocket protocol for Push-to-Talk (PTT)
communication between Android clients and the Talaria server.
"""

import asyncio
import json
import time
import logging
from typing import Optional, Dict, Any, List, Callable

from ..core.connection import WebSocketConnection, ConnectionState, PTTState
from ..core.audio_buffer import AudioBufferManager
from ..core.replay_store import ReplayStore, StoredRun, RunStatus
from ..audio.stt import STTProcessor, StreamingSTTProcessor
from ..audio.tts import TTSProcessor
from ..services.hermes_client import HermesClient

logger = logging.getLogger(__name__)


class MessageHandler:
    """Handles incoming WebSocket messages with type safety."""

    def __init__(self, connection: WebSocketConnection, replay_store: ReplayStore) -> None:
        self.connection = connection
        self.replay_store = replay_store

    async def handle_ptt_start(self, cmd: dict) -> None:
        """Handle PTT start command."""
        client_msg_id = cmd.get("client_message_id")
        if client_msg_id:
            await self.connection.send_message({
                "type": "ptt_start_echo",
                "client_message_id": client_msg_id,
            })

    async def handle_ptt_end(
        self,
        audio_buffer: AudioBufferManager,
        stt: STTProcessor,
        hermes: HermesClient,
        tts: TTSProcessor,
        cancel_event: asyncio.Event,
        streaming_stt: Optional[StreamingSTTProcessor] = None,
    ) -> None:
        """Handle PTT end command - process audio and get response."""
        if self.connection.ptt_state != PTTState.RECORDING:
            return

        self.connection.ptt_state = PTTState.TRANSCRIBING
        await self.connection.send_message({"type": "processing", "step": "stt"})

        # Get accumulated audio
        all_audio = await audio_buffer.get_all()
        await audio_buffer.clear()

        if len(all_audio) < 4096:
            await self.connection.send_message({"type": "error", "message": "Audio too short"})
            self.connection.ptt_state = PTTState.IDLE
            return

        # Final transcription (high accuracy)
        cancel_event.clear()

        if streaming_stt:
            transcript = await streaming_stt.finalize()
        else:
            transcript = await stt.transcribe(all_audio)

        if not transcript:
            await self.connection.send_message({"type": "error", "message": "No speech detected"})
            self.connection.ptt_state = PTTState.IDLE
            return

        await self.connection.send_message({
            "type": "stt_transcript",
            "text": transcript,
            "final": True,
        })
        await self.connection.send_message({"type": "processing", "step": "thinking"})

        # Send to Hermes
        self.connection.ptt_state = PTTState.HERMES_RUNNING
        cancel_event.clear()
        try:
            result = await hermes.start_run(
                transcript,
                session_id=self.connection.current_session_id,
                profile=self.connection.current_profile,
            )
            self.connection.current_run_id = result.get("run_id")
            session_id = result.get("session_id")
            if session_id:
                self.connection.current_session_id = session_id
                await self.connection.send_message({"type": "session_id", "id": session_id})
        except Exception as e:
            logger.exception("Hermes start_run failed")
            await self.connection.send_message({"type": "error", "message": f"Hermes API error: {e}"})
            self.connection.ptt_state = PTTState.IDLE
            return

        # Stream events
        try:
            reply = await hermes.stream_events(
                self.connection.current_run_id,
                cancel_event,
                profile=self.connection.current_profile,
            )
        except Exception as e:
            logger.exception("Hermes stream_events failed")
            await self.connection.send_message({"type": "error", "message": f"Agent error: {e}"})
            self.connection.ptt_state = PTTState.IDLE
            return

        # If interrupted, don't send TTS
        if cancel_event.is_set():
            self.connection.ptt_state = PTTState.IDLE
            cancel_event.clear()
            return

        if not reply:
            await self.connection.send_message({"type": "error", "message": "Empty response"})
            self.connection.ptt_state = PTTState.IDLE
            return

        # Create a StoredRun for replay
        stored_run = StoredRun(
            run_id=self.connection.current_run_id or "",
            session_id=self.connection.current_session_id or "",
            transcript=transcript,
            reply_text=reply,
            created_at=time.monotonic(),
        )

        # Save to store immediately
        if self.connection.current_session_id:
            self.replay_store.put(stored_run)

        # TTS
        await self.connection.send_message({"type": "processing", "step": "tts"})
        await self.connection.send_message({"type": "tts_start", "text": reply})

        self.connection.ptt_state = PTTState.TTS_STREAMING
        cancel_event.clear()

        if tts.is_available():
            try:
                async for chunk in tts.synthesize(reply, cancel_event=cancel_event):
                    if cancel_event.is_set():
                        break
                    seq = await self.connection.send_binary(chunk)
                    stored_run.audio_chunks.append(chunk)
                    if stored_run.seq_start == 0:
                        stored_run.seq_start = seq
                    stored_run.seq_end = seq + 1
                    if self.connection.current_session_id:
                        self.replay_store.put(stored_run)
            except Exception as e:
                logger.exception("TTS error")
                await self.connection.send_message({"type": "tts_fallback", "text": reply})
        else:
            await self.connection.send_message({"type": "tts_fallback", "text": reply})

        if cancel_event.is_set():
            stored_run.interrupted = True
            stored_run.complete = False
            if self.connection.current_session_id:
                self.replay_store.put(stored_run)
            cancel_event.clear()
            self.connection.ptt_state = PTTState.IDLE
            return

        stored_run.complete = True
        if self.connection.current_session_id:
            self.replay_store.put(stored_run)

        await self.connection.send_message({"type": "tts_end"})
        self.connection.ptt_state = PTTState.IDLE

    async def handle_interrupt(self, hermes: HermesClient) -> None:
        """Handle interrupt command (barge-in)."""
        logger.info(
            "Interrupt received (state=%s, run=%s)",
            self.connection.ptt_state,
            self.connection.current_run_id,
        )

        self.connection.ptt_state = PTTState.IDLE

        if self.connection.current_run_id:
            await hermes.stop_run(
                self.connection.current_run_id,
                profile=self.connection.current_profile,
            )

        await self.connection.send_message({
            "type": "interrupted",
            "run_id": self.connection.current_run_id or "",
        })

    async def handle_text_input(
        self,
        cmd: dict,
        hermes: HermesClient,
        replay_store: ReplayStore,
    ) -> None:
        """Handle text input command."""
        if self.connection.ptt_state != PTTState.IDLE:
            await self.connection.send_message({
                "type": "error",
                "message": "Session busy — agent is processing",
            })
            return

        text = cmd.get("text", "").strip()
        if not text:
            await self.connection.send_message({"type": "error", "message": "Empty text input"})
            return

        thread_id = cmd.get("thread_id", "")
        session_id = cmd.get("session_id", "") or self.connection.current_session_id
        profile = cmd.get("profile") or self.connection.current_profile

        logger.info("text_input: session=%s thread=%s profile=%s text=%.100s", session_id, thread_id, profile, text)

        echo_msg = {"type": "text_echo", "text": text}
        client_msg_id = cmd.get("client_message_id")
        if client_msg_id:
            echo_msg["client_message_id"] = client_msg_id
        await self.connection.send_message(echo_msg)

        await self.connection.send_message({"type": "processing", "step": "thinking"})

        self.connection.ptt_state = PTTState.HERMES_RUNNING
        try:
            result = await hermes.start_run(
                text,
                session_id=session_id,
                profile=profile,
            )
            self.connection.current_run_id = result.get("run_id")
            session_id = result.get("session_id")
            if session_id:
                self.connection.current_session_id = session_id
                await self.connection.send_message({
                    "type": "session_id",
                    "id": session_id,
                    "thread_id": thread_id,
                })
        except Exception as e:
            logger.exception("Hermes start_run failed (text_input)")
            await self.connection.send_message({
                "type": "error",
                "message": f"Hermes API error: {e}",
            })
            self.connection.ptt_state = PTTState.IDLE
            return

        try:
            reply = await hermes.stream_events(
                self.connection.current_run_id,
                profile=profile,
            )
        except Exception as e:
            logger.exception("Hermes stream_events failed (text_input)")
            await self.connection.send_message({
                "type": "error",
                "message": f"Agent error: {e}",
            })
            self.connection.ptt_state = PTTState.IDLE
            return

        if not reply:
            await self.connection.send_message({"type": "error", "message": "Empty response"})
            self.connection.ptt_state = PTTState.IDLE
            return

        stored_run = StoredRun(
            run_id=self.connection.current_run_id or "",
            session_id=self.connection.current_session_id or "",
            transcript=text,
            reply_text=reply,
            created_at=time.monotonic(),
            thread_id=thread_id,
            is_text_input=True,
        )
        if self.connection.current_session_id:
            replay_store.put(stored_run)

        await self.connection.send_message({"type": "tts_fallback", "text": reply})

        stored_run.complete = True
        if self.connection.current_session_id:
            replay_store.put(stored_run)

        self.connection.ptt_state = PTTState.IDLE

    async def handle_switch_session(self, cmd: dict) -> None:
        """Handle session switch command."""
        new_session_id = cmd.get("session_id", "")
        new_thread_id = cmd.get("thread_id", "")

        logger.info("switch_session: session=%s thread=%s", new_session_id, new_thread_id)

        if new_session_id:
            self.connection.current_session_id = new_session_id
        if new_thread_id:
            self.connection.thread_id = new_thread_id

        await self.connection.send_message({
            "type": "session_switched",
            "session_id": self.connection.current_session_id or "",
            "thread_id": self.connection.thread_id or "",
        })

    # ── Hermes integration handlers ─────────────────────────

    async def handle_list_sessions(
        self,
        cmd: dict,
        hermes: HermesClient,
    ) -> None:
        """Handle list_sessions command — return recent Hermes sessions."""
        limit = cmd.get("limit", 20)
        source = cmd.get("source")

        sessions = await hermes.list_sessions(limit=limit, source=source)
        await self.connection.send_message({
            "type": "session_list",
            "sessions": sessions,
        })

    async def handle_fork_session(
        self,
        cmd: dict,
        hermes: HermesClient,
    ) -> None:
        """Handle fork_session — fork an existing Hermes session for Talaria use."""
        session_id = cmd.get("session_id", "")
        if not session_id:
            await self.connection.send_message({
                "type": "error",
                "message": "Missing session_id for fork",
            })
            return

        result = await hermes.fork_session(session_id)
        if result is None:
            await self.connection.send_message({
                "type": "error",
                "message": f"Failed to fork session {session_id}",
            })
            return

        new_session_id = result.get("id") or result.get("session_id", "")
        self.connection.current_session_id = new_session_id

        await self.connection.send_message({
            "type": "session_forked",
            "original_session_id": session_id,
            "new_session_id": new_session_id,
            "title": result.get("title", ""),
        })

    async def handle_get_session_history(
        self,
        cmd: dict,
        hermes: HermesClient,
    ) -> None:
        """Handle get_session_history — fetch message history for a session."""
        session_id = cmd.get("session_id", "")
        limit = cmd.get("limit", 50)

        if not session_id:
            await self.connection.send_message({
                "type": "error",
                "message": "Missing session_id",
            })
            return

        messages = await hermes.get_session_messages(session_id, limit=limit)
        await self.connection.send_message({
            "type": "session_history",
            "session_id": session_id,
            "messages": messages,
        })

    async def handle_set_profile(self, cmd: dict) -> None:
        """Handle set_profile — change the active Hermes profile."""
        profile = cmd.get("profile", "")
        self.connection.current_profile = profile or None
        await self.connection.send_message({
            "type": "profile_set",
            "profile": profile,
        })
