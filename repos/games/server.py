"""
games.ffilt.us — Lobby + Game Server
=====================================
Multiplayer lobby system with Chromecast / TV second-screen support.

Players create or join a lobby via WebSocket. The "cast" view (loaded on a TV
via tab-cast or Google Cast receiver) renders the game board in full-screen.
Players on their phones see their controls and turn notifications.

Game protocol (JSON over WebSocket):

  Client → Server:
    create_lobby   { type: "create_lobby", player_name: str }
    join_lobby     { type: "join_lobby", code: str, player_name: str }
    set_name       { type: "set_name", player_name: str }
    start_game     { type: "start_game" }  (host only)
    submit_number  { type: "submit_number", value: int }  (current player only)
    tv_connect     { type: "tv_connect" }  (marks connection as TV view)
    leave          { type: "leave" }

  Server → Client:
    lobby_created   { type: "lobby_created", code: str, player_id: str }
    lobby_joined    { type: "lobby_joined", code: str, players: [...], host: str, player_id: str }
    player_joined   { type: "player_joined", player: { name, id } }
    player_left     { type: "player_left", player_id: str, new_host?: str }
    player_renamed  { type: "player_renamed", player_id: str, player_name: str }
    game_started    { type: "game_started", game: str, players: [...], max_rounds: int }
    game_state      { type: "game_state", state: { ... } }
    your_turn       { type: "your_turn", round: int }
    turn_changed    { type: "turn_changed", player: { name, id }, round: int, turn_index: int }
    number_received { type: "number_received", player_name: str, value: int }
    game_over       { type: "game_over", results: [...], entries: [...] }
    error           { type: "error", message: str }
"""

from __future__ import annotations
import json
import os
import random
import string
import uuid
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# ── Globals ──────────────────────────────────────────────────────────────

LOBBIES: dict[str, "Lobby"] = {}
CODE_ALPHABET = string.ascii_uppercase + string.digits

# ── Models ───────────────────────────────────────────────────────────────

class Player:
    def __init__(self, name: str, ws: WebSocket, is_tv: bool = False):
        self.id = uuid.uuid4().hex[:8]
        self.name = name
        self.ws = ws
        self.is_tv = is_tv  # TV connections don't play, they just watch

    def to_dict(self):
        return {"id": self.id, "name": self.name}

    async def send(self, data: dict):
        try:
            await self.ws.send_json(data)
        except Exception:
            pass


class NumeralsGame:
    """Turn-based game where each player enters a digit 0-9 per round."""

    def __init__(self, players: list[Player]):
        self.players = players
        self.max_rounds = 5
        self.round = 0
        self.turn_index = 0
        self.entries: list[dict] = []  # {player_id, player_name, round, value}
        self.finished = False
        self._round_started = False

    @property
    def current_player(self) -> Optional[Player]:
        if self.finished or self.round >= self.max_rounds:
            return None
        return self.players[self.turn_index]

    def submit(self, player_id: str, value: int) -> bool:
        """Record a submission. Returns True if turn advances."""
        if self.finished:
            return False
        if self.current_player is None or self.current_player.id != player_id:
            return False
        if not (0 <= value <= 9):
            return False

        self.entries.append({
            "player_id": player_id,
            "player_name": self.current_player.name,
            "round": self.round,
            "value": value,
        })

        # Advance to next player
        self.turn_index += 1
        if self.turn_index >= len(self.players):
            self.turn_index = 0
            self.round += 1
            if self.round >= self.max_rounds:
                self.finished = True

        return True

    def get_state(self) -> dict:
        return {
            "game": "demo-numerals",
            "round": self.round,
            "max_rounds": self.max_rounds,
            "players": [p.to_dict() for p in self.players],
            "turn_index": self.turn_index,
            "current_player": self.current_player.to_dict() if self.current_player else None,
            "entries": self.entries,
            "finished": self.finished,
        }

    def get_results(self) -> list[dict]:
        """Build per-player results."""
        results = []
        for p in self.players:
            player_entries = [e for e in self.entries if e["player_id"] == p.id]
            total = sum(e["value"] for e in player_entries)
            results.append({
                "player": p.to_dict(),
                "entries": player_entries,
                "total": total,
                "average": round(total / max(len(player_entries), 1), 2),
            })
        results.sort(key=lambda r: r["total"], reverse=True)
        return results


class Lobby:
    def __init__(self, code: str, host: Player):
        self.code = code
        self.players: list[Player] = [host]
        self.host_id = host.id
        self.game: Optional[NumeralsGame] = None
        self.tv_viewers: list[Player] = []

    def add_player(self, player: Player) -> bool:
        if len(self.players) >= 8:
            return False
        if player.is_tv:
            self.tv_viewers.append(player)
            return True
        self.players.append(player)
        return True

    def remove_player(self, player_id: str) -> Optional[str]:
        """Remove a player. Returns new host ID if host changed."""
        self.players = [p for p in self.players if p.id != player_id]
        self.tv_viewers = [p for p in self.tv_viewers if p.id != player_id]

        if self.host_id == player_id and self.players:
            self.host_id = self.players[0].id
            return self.host_id
        return None

    def get_player_by_id(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        for p in self.tv_viewers:
            if p.id == player_id:
                return p
        return None

    def to_dict(self):
        return {
            "code": self.code,
            "players": [p.to_dict() for p in self.players],
            "host": self.host_id,
            "player_count": len(self.players),
            "game_active": self.game is not None,
        }

    async def broadcast(self, data: dict, exclude: Optional[str] = None):
        for p in self.players:
            if p.id != exclude:
                await p.send(data)
        for p in self.tv_viewers:
            if p.id != exclude:
                await p.send(data)

    async def broadcast_players(self, exclude: Optional[str] = None):
        await self.broadcast({
            "type": "players_update",
            "players": [p.to_dict() for p in self.players],
            "host": self.host_id,
        }, exclude=exclude)


# ── App ─────────────────────────────────────────────────────────────────

app = FastAPI(title="games.ffilt.us")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def generate_code() -> str:
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=6))
        if code not in LOBBIES:
            return code


# ── Routes ──────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/tv/{code}")
async def tv_view(code: str):
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/health")
async def health():
    return {"status": "ok", "lobbies": len(LOBBIES)}


# ── WebSocket ───────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    player: Optional[Player] = None
    lobby: Optional[Lobby] = None

    async def send_error(msg: str):
        await ws.send_json({"type": "error", "message": msg})

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            # ── Create Lobby ───────────────────────────────────────────
            if msg_type == "create_lobby":
                name = data.get("player_name", "").strip() or f"Player_{uuid.uuid4().hex[:4]}"
                code = generate_code()
                player = Player(name, ws)
                lobby = Lobby(code, player)
                LOBBIES[code] = lobby
                await ws.send_json({
                    "type": "lobby_created",
                    "code": code,
                    "player_id": player.id,
                })
                await lobby.broadcast_players()

            # ── Join Lobby ─────────────────────────────────────────────
            elif msg_type == "join_lobby":
                code = data.get("code", "").upper().strip()
                name = data.get("player_name", "").strip() or f"Player_{uuid.uuid4().hex[:4]}"
                lobby = LOBBIES.get(code)
                if not lobby:
                    await send_error("Lobby not found")
                    continue
                if lobby.game:
                    await send_error("Game already in progress")
                    continue
                player = Player(name, ws)
                if not lobby.add_player(player):
                    await send_error("Lobby is full (max 8)")
                    continue
                await ws.send_json({
                    "type": "lobby_joined",
                    "code": code,
                    "player_id": player.id,
                    "players": [p.to_dict() for p in lobby.players],
                    "host": lobby.host_id,
                })
                await lobby.broadcast({
                    "type": "player_joined",
                    "player": player.to_dict(),
                }, exclude=player.id)
                await lobby.broadcast_players()

            # ── TV Connect ─────────────────────────────────────────────
            elif msg_type == "tv_connect":
                code = data.get("code", "").upper().strip()
                lobby = LOBBIES.get(code)
                if not lobby:
                    await send_error("Lobby not found")
                    continue
                player = Player("📺 TV", ws, is_tv=True)
                lobby.add_player(player)
                # Send full game state if game is active
                if lobby.game:
                    await ws.send_json({
                        "type": "game_state",
                        "state": lobby.game.get_state(),
                    })
                else:
                    await ws.send_json({
                        "type": "tv_connected",
                        "code": code,
                        "player_id": player.id,
                        "players": [p.to_dict() for p in lobby.players],
                        "host": lobby.host_id,
                    })

            # ── Set Name ───────────────────────────────────────────────
            elif msg_type == "set_name":
                if player and lobby:
                    new_name = data.get("player_name", "").strip()
                    if new_name:
                        player.name = new_name
                        await lobby.broadcast({
                            "type": "player_renamed",
                            "player_id": player.id,
                            "player_name": new_name,
                        })
                        await lobby.broadcast_players()

            # ── Start Game ─────────────────────────────────────────────
            elif msg_type == "start_game":
                if not player or not lobby:
                    await send_error("Not in a lobby")
                    continue
                if player.id != lobby.host_id:
                    await send_error("Only the host can start the game")
                    continue
                if len(lobby.players) < 2:
                    await send_error("Need at least 2 players")
                    continue
                if lobby.game:
                    await send_error("Game already started")
                    continue

                # Shuffle turn order
                game_players = list(lobby.players)
                random.shuffle(game_players)
                lobby.game = NumeralsGame(game_players)

                await lobby.broadcast({
                    "type": "game_started",
                    "game": "demo-numerals",
                    "players": [p.to_dict() for p in game_players],
                    "max_rounds": lobby.game.max_rounds,
                })

                # Notify first player
                first = lobby.game.current_player
                if first:
                    await first.send({
                        "type": "your_turn",
                        "round": lobby.game.round,
                    })
                    await lobby.broadcast({
                        "type": "turn_changed",
                        "player": first.to_dict(),
                        "round": lobby.game.round,
                        "turn_index": lobby.game.turn_index,
                    }, exclude=first.id)

            # ── Submit Number ─────────────────────────────────────────
            elif msg_type == "submit_number":
                if not player or not lobby or not lobby.game:
                    await send_error("No active game")
                    continue
                value = data.get("value")
                if value is None or not isinstance(value, int) or value < 0 or value > 9:
                    await send_error("Value must be an integer 0-9")
                    continue

                game = lobby.game
                prev_player = game.current_player
                if prev_player and prev_player.id != player.id:
                    await send_error("Not your turn")
                    continue

                if game.submit(player.id, value):
                    # Broadcast the number submission
                    await lobby.broadcast({
                        "type": "number_received",
                        "player_name": player.name,
                        "value": value,
                        "round": game.round,
                        "entries": game.entries,
                    })

                    if game.finished:
                        results = game.get_results()
                        await lobby.broadcast({
                            "type": "game_over",
                            "results": results,
                            "entries": game.entries,
                        })
                    else:
                        next_player = game.current_player
                        if next_player:
                            await next_player.send({
                                "type": "your_turn",
                                "round": game.round,
                            })
                            await lobby.broadcast({
                                "type": "turn_changed",
                                "player": next_player.to_dict(),
                                "round": game.round,
                                "turn_index": game.turn_index,
                            }, exclude=next_player.id)

                        # If round just incremented, send round update
                        # (round in the broadcast already updated by submit())
                        if game.round > 0:
                            pass  # round info is already in turn_changed

            # ── Leave ─────────────────────────────────────────────────
            elif msg_type == "leave":
                if player and lobby:
                    pid = player.id
                    new_host = lobby.remove_player(pid)
                    msg = {"type": "player_left", "player_id": pid}
                    if new_host:
                        msg["new_host"] = new_host
                    await lobby.broadcast(msg)
                    await lobby.broadcast_players()
                    if len(lobby.players) == 0:
                        LOBBIES.pop(lobby.code, None)
                player = None
                lobby = None

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS error: {e}")
    finally:
        if player and lobby:
            pid = player.id
            new_host = lobby.remove_player(pid)
            msg = {"type": "player_left", "player_id": pid}
            if new_host:
                msg["new_host"] = new_host
            await lobby.broadcast(msg)
            await lobby.broadcast_players()
            if len(lobby.players) == 0 and len(lobby.tv_viewers) == 0:
                LOBBIES.pop(lobby.code, None)


# ── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")
