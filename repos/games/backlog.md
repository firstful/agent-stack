# Games — Backlog

## Overview

Multiplayer party game server with TV second-screen support. FastAPI + WebSocket-based lobby system supporting number-guessing games. Players join via phone, cast game board to TV, and play together in real-time. Deployed at games.ffilt.us.

## Status

- **Completion**: 1/6 deliverables done (core deployed, initial game playable)
- **Phase/Stage**: Alpha — single game type, full lobby + game loop + TV view working
- **Last updated**: 2026-06-26

## Deliverables

### Core Server & Lobby (3/3 complete)
- [x] Lobby system with create/join/leave (6-digit codes)
- [x] WebSocket protocol with typed messages
- [x] Connection management and player tracking

### Game Engine (1/2 complete)
- [x] Number guessing game (submit_number, round tracking, game_over with results)
- [ ] Additional game types (word games, trivia, drawing, etc.)

### Frontend (2/2 complete)
- [x] Phone UI (landing, lobby, game controls with numpad, game over)
- [x] TV view (game board with player tiles, round history, results)

### TV / Chromecast Integration (0/1 complete)
- [ ] Google Cast receiver app (currently relies on tab-casting from browser)

### Infrastructure & Polish (1/2 complete)
- [x] Blue-green deployment with queue strategy
- [ ] Rate limiting and anti-spam on lobby creation

### Testing (0/1 complete)
- [ ] E2E tests for lobby lifecycle and game rounds

## Open Questions / Blockers

None.

## Notes

- Single `server.py` (462 lines) contains all server and game logic
- Static frontend is a single `index.html` with embedded CSS/JS (976 lines)
- Dockerfile uses `python:3.12-slim` with fastapi + uvicorn
- Currently deployed on slot b, port 4009, exposed at games.ffilt.us
- No Redis/Postgres dependency — all state in-memory
