#!/usr/bin/env python3
"""Fuse task builder — broad epics recursively decomposed, with dependency chains.

Usage:
  python3 build-tasks.py [--out fuse-tasks.yaml]
"""

import argparse
import importlib.util
import os
import sys
from datetime import datetime, timezone

_script_dir = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("genkey", os.path.join(_script_dir, "gen-key.py"))
genkey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(genkey)

# ── Task definition helpers ──────────────────────────────────────────────

class Task:
    def __init__(self, ref: str, title: str, *, depends_on: list[str] | None = None,
                 complexity: int = 1, loe: int = 1, task_type: str = "task",
                 parent_ref: str | None = None, phase: str = "phase-1",
                 priority: str = "P3"):
        self.ref = ref
        self.title = title
        self.depends_on = depends_on or []
        self.complexity = complexity
        self.loe = loe
        self.task_type = task_type
        self.parent_ref = parent_ref
        self.phase = phase
        self.priority = priority
        self.key: str | None = None

    def __repr__(self):
        return f"<Task {self.ref}: {self.title}>"

# ── Task tree ────────────────────────────────────────────────────────────
# ref format: "<phase>-<letter>" for epics, "<phase>-<letter><num>" for sub-tasks
# Dependencies reference other refs or parent keys.

TASKS: list[Task] = []

def E(ref, title, **kw):
    """Add an epic task."""
    kw.setdefault("task_type", "epic")
    kw.setdefault("priority", "P0")
    TASKS.append(Task(ref, title, **kw))

def T(ref, title, **kw):
    """Add a regular task."""
    TASKS.append(Task(ref, title, **kw))


# ══════════════════════════════════════════════════════════════════════════
# Phase 1 — Monorepo Foundation
# ══════════════════════════════════════════════════════════════════════════
P = "phase-1"

E("1-a", "Monorepo workspace setup",
  phase=P, priority="P0")
T("1-a1", "Create npm workspaces (packages/core, server, cloud)", depends_on=["1-a"],
  phase=P, priority="P0", parent_ref="1-a")
T("1-a2", "Shared tsconfig.base.json + per-package tsconfig", depends_on=["1-a"],
  phase=P, priority="P0", parent_ref="1-a")
T("1-a3", "Workspace build scripts (build, dev, test)", depends_on=["1-a"],
  phase=P, priority="P0", parent_ref="1-a")

E("1-b", "Core package extraction & bootstrap",
  phase=P, priority="P0")
T("1-b1", "Split old src/ into packages/core — API routes, DB, auth, SMTP, WS, events, types", depends_on=["1-a", "3-a"],
  phase=P, priority="P0", parent_ref="1-b")
T("1-b2", "Extract shared bootstrap() function from old entrypoint", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="1-b")
T("1-b3", "Public API exports (index.ts) for core", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="1-b")

E("1-c", "Server package (self-hosted runtime)",
  phase=P, priority="P0")
T("1-c1", "Server entrypoint with auto-provision middleware", depends_on=["1-b2"],
  phase=P, priority="P0", parent_ref="1-c")
T("1-c2", "Single-tenant domain resolver (always same domain)", depends_on=["1-c1"],
  phase=P, priority="P0", parent_ref="1-c")
T("1-c3", "Setup wizard — first-boot admin user + domain creation", depends_on=["1-c1"],
  phase=P, priority="P1", parent_ref="1-c")

E("1-d", "Cloud package scaffold (SaaS multi-tenant)",
  phase=P, priority="P0")
T("1-d1", "Cloud entrypoint with domain resolver middleware", depends_on=["1-b2", "3-a"],
  phase=P, priority="P0", parent_ref="1-d")
T("1-d2", "Multi-tenant resolver (Host header / API key)", depends_on=["1-d1"],
  phase=P, priority="P1", parent_ref="1-d")
T("1-d3", "Shard router stub (domain-based cross-region)", depends_on=["1-d1"],
  phase=P, priority="P2", parent_ref="1-d")
T("1-d4", "Provider adapter factory (AI, email, queue, KMS)", depends_on=["1-d1"],
  phase=P, priority="P1", parent_ref="1-d")

E("1-e", "Docker build & deployment",
  phase=P, priority="P0")
T("1-e1", "Multi-stage Dockerfile (core + server targets)", depends_on=["1-a", "1-b1", "1-c1"],
  phase=P, priority="P0", parent_ref="1-e")
T("1-e2", "docker-compose.yml (postgres + maddy + minio + app)", depends_on=["1-e1"],
  phase=P, priority="P0", parent_ref="1-e")
T("1-e3", "docker-compose.cloud.yml (+ redis for Bull, Stripe receiver)", depends_on=["1-e1", "1-d1"],
  phase=P, priority="P1", parent_ref="1-e")
T("1-e4", "CI/CD — lint, typecheck, test, build, publish to GHCR", depends_on=["1-e1"],
  phase=P, priority="P0", parent_ref="1-e")
T("1-e5", "ARM64 build for homelab / Raspberry Pi", depends_on=["1-e4"],
  phase=P, priority="P2", parent_ref="1-e")

E("1-f", "Dev tooling & quality",
  phase=P, priority="P0")
T("1-f1", "Vitest configuration + test harness", depends_on=["1-a"],
  phase=P, priority="P0", parent_ref="1-f")
T("1-f2", "ESLint + Prettier config", depends_on=["1-a"],
  phase=P, priority="P0", parent_ref="1-f")
T("1-f3", "Health check & readiness endpoints", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="1-f")
T("1-f4", "Structured logging (pino or similar)", depends_on=["1-b1"],
  phase=P, priority="P1", parent_ref="1-f")
T("1-f5", "Prometheus metrics endpoint", depends_on=["1-b1"],
  phase=P, priority="P2", parent_ref="1-f")

# ══════════════════════════════════════════════════════════════════════════
# Phase 2 — Database & Storage
# ══════════════════════════════════════════════════════════════════════════
P = "phase-2"

E("2-a", "PostgreSQL schema & migrations",
  phase=P, priority="P0")
T("2-a1", "Migration runner (001_initial.sql with all tables)", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="2-a")
T("2-a2", "Domain row-level security (RLS policies for multi-tenant)", depends_on=["2-a1", "1-d2"],
  phase=P, priority="P1", parent_ref="2-a")
T("2-a3", "Connection pool with read-replica support", depends_on=["2-a1"],
  phase=P, priority="P1", parent_ref="2-a")

E("2-b", "Object storage (S3/MinIO)",
  phase=P, priority="P0")
T("2-b1", "S3 client abstraction (attachments, blobs, rich embeds)", depends_on=["2-a1"],
  phase=P, priority="P0", parent_ref="2-b")
T("2-b2", "Blob mode — per-blob encryption key distribution", depends_on=["2-b1", "8-a"],
  phase=P, priority="P2", parent_ref="2-b")

# ══════════════════════════════════════════════════════════════════════════
# Phase 3 — SMTP & Email Engine
# ══════════════════════════════════════════════════════════════════════════
P = "phase-3"

E("3-a", "SMTP proxy & Maddy bridge",
  phase=P, priority="P0")
T("3-a1", "Node SMTP proxy (smtp-server) on :587, passthrough to Maddy :2525", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="3-a")
T("3-a2", "FUSE EHLO keyword advertisement during SMTP handshake", depends_on=["3-a1"],
  phase=P, priority="P0", parent_ref="3-a")
T("3-a3", "STARTFUSE command handler & webhook endpoint exchange", depends_on=["3-a1"],
  phase=P, priority="P1", parent_ref="3-a")
T("3-a4", "Postgres LISTEN/NOTIFY → WebSocket notification bridge", depends_on=["3-a1", "7-b"],
  phase=P, priority="P0", parent_ref="3-a")
T("3-a5", "TypeScript connection state machine with guards", depends_on=["3-a1"],
  phase=P, priority="P1", parent_ref="3-a")

E("3-b", "Rich mail format",
  phase=P, priority="P1")
T("3-b1", "RICH_MAIL JSON schema (reactions, threads, read receipts)", depends_on=["3-a1"],
  phase=P, priority="P1", parent_ref="3-b")
T("3-b2", "RFC 5322 ↔ rich JSON conversion", depends_on=["3-b1"],
  phase=P, priority="P1", parent_ref="3-b")
T("3-b3", "Round-trip encoding tests", depends_on=["3-b2"],
  phase=P, priority="P1", parent_ref="3-b")

E("3-c", "Email delivery & routing",
  phase=P, priority="P0")
T("3-c1", "Standard SMTP fallback for non-FUSE recipients (via Maddy)", depends_on=["3-a1"],
  phase=P, priority="P0", parent_ref="3-c")
T("3-c2", "Legacy email visual container (orange border, EXTERNAL badge)", depends_on=["3-c1"],
  phase=P, priority="P1", parent_ref="3-c")
T("3-c3", "Inbound SMTP spam filtering (DKIM/DMARC/DNSBL)", depends_on=["3-c1"],
  phase=P, priority="P2", parent_ref="3-c")

# ══════════════════════════════════════════════════════════════════════════
# Phase 4 — Auth & Identity
# ══════════════════════════════════════════════════════════════════════════
P = "phase-4"

E("4-a", "Authentication (self-hosted + SaaS)",
  phase=P, priority="P0")
T("4-a1", "Magic-link login — token generation, email delivery, verification", depends_on=["2-a1", "3-a1"],
  phase=P, priority="P0", parent_ref="4-a")
T("4-a2", "JWT session creation + refresh token rotation", depends_on=["4-a1"],
  phase=P, priority="P0", parent_ref="4-a")
T("4-a3", "Auth middleware (Bearer, X-Fuse-Session, cookie)", depends_on=["4-a2"],
  phase=P, priority="P0", parent_ref="4-a")
T("4-a4", "OAuth providers (Google, GitHub, Microsoft)", depends_on=["4-a1"],
  phase=P, priority="P1", parent_ref="4-a")
T("4-a5", "OIDC (BYOIDP) for enterprise tenants", depends_on=["4-a4"],
  phase=P, priority="P1", parent_ref="4-a")

E("4-b", "Identity model",
  phase=P, priority="P0")
T("4-b1", "Identity CRUD with types: human, agent, shared, service, guest", depends_on=["2-a1"],
  phase=P, priority="P0", parent_ref="4-b")
T("4-b2", "Domain-claim registration via DNS TXT verification", depends_on=["4-b1", "1-c3"],
  phase=P, priority="P1", parent_ref="4-b")
T("4-b3", "Multi-device sessions — per-device refresh tokens", depends_on=["4-a2"],
  phase=P, priority="P1", parent_ref="4-b")
T("4-b4", "Public key upload/revocation (Ed25519, X25519)", depends_on=["4-b1"],
  phase=P, priority="P2", parent_ref="4-b")

E("4-c", "Team identities",
  phase=P, priority="P1")
T("4-c1", "Team identity data model with members & roles", depends_on=["4-b1"],
  phase=P, priority="P1", parent_ref="4-c")
T("4-c2", "Act-as switching (user → shared identity)", depends_on=["4-c1"],
  phase=P, priority="P1", parent_ref="4-c")
T("4-c3", "Multiple concurrent backers (support@ #1, #2)", depends_on=["4-c2"],
  phase=P, priority="P2", parent_ref="4-c")
T("4-c4", "Cross-modality participation (email, chat, meetings, voice, docs)", depends_on=["4-c1"],
  phase=P, priority="P2", parent_ref="4-c")
T("4-c5", "Canned responses / snippets", depends_on=["4-c1"],
  phase=P, priority="P2", parent_ref="4-c")

# ══════════════════════════════════════════════════════════════════════════
# Phase 5 — Chat Channels
# ══════════════════════════════════════════════════════════════════════════
P = "phase-5"

E("5-a", "Channel core",
  phase=P, priority="P0")
T("5-a1", "Channel CRUD — types: public, private, DM, group, cross-org", depends_on=["4-b1"],
  phase=P, priority="P0", parent_ref="5-a")
T("5-a2", "Channel membership — roles: owner, admin, member, guest", depends_on=["5-a1"],
  phase=P, priority="P0", parent_ref="5-a")
T("5-a3", "Channel permissions / ACL", depends_on=["5-a2"],
  phase=P, priority="P1", parent_ref="5-a")

E("5-b", "Messages & threading",
  phase=P, priority="P0")
T("5-b1", "Message CRUD with rich JSONB payload", depends_on=["5-a1"],
  phase=P, priority="P0", parent_ref="5-b")
T("5-b2", "Cursor-based pagination", depends_on=["5-b1"],
  phase=P, priority="P0", parent_ref="5-b")
T("5-b3", "Threaded replies (nested, not flat)", depends_on=["5-b1"],
  phase=P, priority="P1", parent_ref="5-b")
T("5-b4", "Message editing with history, soft-delete with undo", depends_on=["5-b1"],
  phase=P, priority="P1", parent_ref="5-b")
T("5-b5", "Reactions, read receipts, pinning", depends_on=["5-b1"],
  phase=P, priority="P1", parent_ref="5-b")

E("5-c", "Real-time features",
  phase=P, priority="P1")
T("5-c1", "WebSocket server with JSON protocol", depends_on=["1-b1"],
  phase=P, priority="P0", parent_ref="5-c")
T("5-c2", "Presence state machine (online, away, DND, invisible)", depends_on=["5-c1", "5-a1"],
  phase=P, priority="P1", parent_ref="5-c")
T("5-c3", "Typing indicators", depends_on=["5-c1"],
  phase=P, priority="P1", parent_ref="5-c")
T("5-c4", "Real-time message delivery via WS", depends_on=["5-c1", "5-b1"],
  phase=P, priority="P0", parent_ref="5-c")

E("5-d", "Channel UX",
  phase=P, priority="P1")
T("5-d1", "Slash commands (/schedule, /poll, /todo, /email, /ai)", depends_on=["5-a1"],
  phase=P, priority="P1", parent_ref="5-d")
T("5-d2", "Channel categories & bookmarks", depends_on=["5-a1"],
  phase=P, priority="P2", parent_ref="5-d")
T("5-d3", "Rich text, markdown, @mentions, emoji", depends_on=["5-b1"],
  phase=P, priority="P1", parent_ref="5-d")
T("5-d4", "Granular notification settings per channel", depends_on=["5-a2"],
  phase=P, priority="P1", parent_ref="5-d")

# ══════════════════════════════════════════════════════════════════════════
# Phase 6 — Federation
# ══════════════════════════════════════════════════════════════════════════
P = "phase-6"

E("6-a", "Domain trust & discovery",
  phase=P, priority="P1")
T("6-a1", "Trust level data model (0–4) with scoring", depends_on=["4-b1"],
  phase=P, priority="P1", parent_ref="6-a")
T("6-a2", "DNS auto-discovery (_fuse TXT record)", depends_on=["6-a1"],
  phase=P, priority="P1", parent_ref="6-a")
T("6-a3", "SMTP discovery → webhook endpoint exchange", depends_on=["6-a2", "3-a3"],
  phase=P, priority="P1", parent_ref="6-a")
T("6-a4", "Domain admin dashboard (trust config)", depends_on=["6-a1"],
  phase=P, priority="P2", parent_ref="6-a")

E("6-b", "Webhook delivery",
  phase=P, priority="P1")
T("6-b1", "Webhook payload schema & delivery format", depends_on=["6-a1"],
  phase=P, priority="P1", parent_ref="6-b")
T("6-b2", "Domain Ed25519 key pair generation", depends_on=["6-b1"],
  phase=P, priority="P1", parent_ref="6-b")
T("6-b3", "Message signing (X-Fuse-Signature) & verification", depends_on=["6-b2"],
  phase=P, priority="P1", parent_ref="6-b")
T("6-b4", "ECDH + AES session key hybrid encryption", depends_on=["6-b2"],
  phase=P, priority="P2", parent_ref="6-b")
T("6-b5", "Exponential backoff delivery queue", depends_on=["6-b1"],
  phase=P, priority="P2", parent_ref="6-b")
T("6-b6", "Public key endpoint & key rotation", depends_on=["6-b1"],
  phase=P, priority="P1", parent_ref="6-b")

E("6-c", "Cross-org channels",
  phase=P, priority="P2")
T("6-c1", "Cross-org channel membership data model", depends_on=["5-a1", "6-a1"],
  phase=P, priority="P2", parent_ref="6-c")
T("6-c2", "Channel invitation flow across domains", depends_on=["6-c1"],
  phase=P, priority="P2", parent_ref="6-c")
T("6-c3", "Shared channel message sync protocol", depends_on=["6-c1"],
  phase=P, priority="P2", parent_ref="6-c")
T("6-c4", "Cross-org member discovery & directory", depends_on=["6-c1"],
  phase=P, priority="P2", parent_ref="6-c")
T("6-c5", "Identity type policy per domain (allow/block/downgrade)", depends_on=["6-a1", "4-b1"],
  phase=P, priority="P2", parent_ref="6-c")

# ══════════════════════════════════════════════════════════════════════════
# Phase 7 — Meetings & Voice
# ══════════════════════════════════════════════════════════════════════════
P = "phase-7"

E("7-a", "Calendar & scheduling",
  phase=P, priority="P1")
T("7-a1", "CalDAV sync (Apple, Thunderbird, Google, Outlook)", depends_on=["4-b1"],
  phase=P, priority="P2", parent_ref="7-a")
T("7-a2", "Meeting data model — state machine (scheduled → ringing → active → ended)", depends_on=["7-a1"],
  phase=P, priority="P1", parent_ref="7-a")
T("7-a3", "Time polls (Doodle-style)", depends_on=["7-a1"],
  phase=P, priority="P2", parent_ref="7-a")

E("7-b", "Video meetings (LiveKit)",
  phase=P, priority="P1")
T("7-b1", "LiveKit server integration (room create/join/end)", depends_on=["7-a2"],
  phase=P, priority="P1", parent_ref="7-b")
T("7-b2", "WebRTC client (browser media)", depends_on=["7-b1"],
  phase=P, priority="P1", parent_ref="7-b")
T("7-b3", "Chat ↔ meeting fluid modality", depends_on=["7-b1", "5-a1"],
  phase=P, priority="P2", parent_ref="7-b")
T("7-b4", "Meeting recording & transcription", depends_on=["7-b1"],
  phase=P, priority="P2", parent_ref="7-b")
T("7-b5", "Cross-org meeting invites & RSVP", depends_on=["7-b1", "6-a1"],
  phase=P, priority="P2", parent_ref="7-b")

E("7-c", "Voice channels",
  phase=P, priority="P2")
T("7-c1", "Persistent open voice channels (Discord-style)", depends_on=["7-b1", "5-a1"],
  phase=P, priority="P2", parent_ref="7-c")
T("7-c2", "Stage mode (speakers + listen-only audience)", depends_on=["7-c1"],
  phase=P, priority="P2", parent_ref="7-c")
T("7-c3", "Push-to-talk + VAD", depends_on=["7-c1"],
  phase=P, priority="P2", parent_ref="7-c")
T("7-c4", "Screen sharing", depends_on=["7-c1"],
  phase=P, priority="P2", parent_ref="7-c")
T("7-c5", "Cross-org voice channels", depends_on=["7-c1", "6-a1"],
  phase=P, priority="P3", parent_ref="7-c")

E("7-d", "AI meeting features",
  phase=P, priority="P3")
T("7-d1", "AI stand-in — join meeting, post summary to channel", depends_on=["7-b1", "9-b4"],
  phase=P, priority="P3", parent_ref="7-d")
T("7-d2", "AI scheduling assistant (natural language)", depends_on=["7-a1"],
  phase=P, priority="P3", parent_ref="7-d")
T("7-d3", "Voice channel transcription bot", depends_on=["7-c1"],
  phase=P, priority="P3", parent_ref="7-d")

# ══════════════════════════════════════════════════════════════════════════
# Phase 8 — Document Store
# ══════════════════════════════════════════════════════════════════════════
P = "phase-8"

E("8-a", "Document model & API",
  phase=P, priority="P1")
T("8-a1", "Page CRUD with JSONB blocks", depends_on=["2-a1"],
  phase=P, priority="P1", parent_ref="8-a")
T("8-a2", "Block data model (types, attributes, children, 20+ block types)", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-a")
T("8-a3", "Page hierarchy with nested pages", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-a")
T("8-a4", "Channel-wiki integration (/docs per channel)", depends_on=["8-a1", "5-a1"],
  phase=P, priority="P2", parent_ref="8-a")

E("8-b", "Block editor (Notion-style)",
  phase=P, priority="P2")
T("8-b1", "TipTap/ProseMirror editor integration", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-b")
T("8-b2", "Core block renderers (paragraph, heading, list, quote, code)", depends_on=["8-b1"],
  phase=P, priority="P2", parent_ref="8-b")
T("8-b3", "Drag-and-drop block reordering", depends_on=["8-b1"],
  phase=P, priority="P2", parent_ref="8-b")
T("8-b4", "Slash command menu for block insertion", depends_on=["8-b1"],
  phase=P, priority="P2", parent_ref="8-b")
T("8-b5", "Comment threads on blocks (Google Docs-style)", depends_on=["8-b1"],
  phase=P, priority="P2", parent_ref="8-b")

E("8-c", "Real-time collaboration",
  phase=P, priority="P2")
T("8-c1", "Yjs CRDT library integration", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-c")
T("8-c2", "WebSocket sync provider", depends_on=["8-c1"],
  phase=P, priority="P2", parent_ref="8-c")
T("8-c3", "Cursor presence & awareness", depends_on=["8-c2"],
  phase=P, priority="P2", parent_ref="8-c")
T("8-c4", "Offline edits + sync on reconnect", depends_on=["8-c2"],
  phase=P, priority="P2", parent_ref="8-c")

E("8-d", "Document features",
  phase=P, priority="P2")
T("8-d1", "Database views (table, board, calendar, gallery)", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-d")
T("8-d2", "Templates (meeting notes, ADR, postmortem, OKR)", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-d")
T("8-d3", "Version history + diff/restore", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-d")
T("8-d4", "Export (markdown, HTML, PDF, JSON)", depends_on=["8-a1"],
  phase=P, priority="P2", parent_ref="8-d")
T("8-d5", "Cross-org shared docs", depends_on=["8-a1", "6-a1"],
  phase=P, priority="P3", parent_ref="8-d")

# ══════════════════════════════════════════════════════════════════════════
# Phase 9 — AI & Intelligence
# ══════════════════════════════════════════════════════════════════════════
P = "phase-9"

E("9-a", "AI engine",
  phase=P, priority="P2")
T("9-a1", "LLM provider abstraction (OpenAI-compatible API)", depends_on=["1-d4"],
  phase=P, priority="P2", parent_ref="9-a")
T("9-a2", "Per-channel AI agent (implicit @ai)", depends_on=["9-a1", "5-a1"],
  phase=P, priority="P2", parent_ref="9-a")
T("9-a3", "Knowledge graph for cross-channel memory", depends_on=["9-a1"],
  phase=P, priority="P3", parent_ref="9-a")
T("9-a4", "Slash command: /ai <prompt>", depends_on=["9-a2", "5-d1"],
  phase=P, priority="P2", parent_ref="9-a")
T("9-a5", "AI model sourcing — self-hosted BYOK, SaaS billed", depends_on=["9-a1"],
  phase=P, priority="P2", parent_ref="9-a")

# ══════════════════════════════════════════════════════════════════════════
# Phase 10 — E2EE & Security
# ══════════════════════════════════════════════════════════════════════════
P = "phase-10"

E("10-a", "E2EE protocol",
  phase=P, priority="P2")
T("10-a1", "Three-key model (Identity Ed25519, GM X25519, Recovery Ed25519)", depends_on=["4-b4"],
  phase=P, priority="P2", parent_ref="10-a")
T("10-a2", "Shared K_g + Ed25519 signatures for groups", depends_on=["10-a1"],
  phase=P, priority="P2", parent_ref="10-a")
T("10-a3", "Epoch hash membership binding", depends_on=["10-a2"],
  phase=P, priority="P2", parent_ref="10-a")
T("10-a4", "INVITE/JOIN/REMOVE protocol (per-member encrypted K_g delivery)", depends_on=["10-a2"],
  phase=P, priority="P2", parent_ref="10-a")
T("10-a5", "RECOVER — device loss recovery via recovery key", depends_on=["10-a1"],
  phase=P, priority="P2", parent_ref="10-a")
T("10-a6", "Encrypted keyword trie (CTR-based SSE) for search", depends_on=["10-a2"],
  phase=P, priority="P3", parent_ref="10-a")
T("10-a7", "Privacy slider (E2EE → E2EE+Search → S2EE)", depends_on=["10-a2"],
  phase=P, priority="P2", parent_ref="10-a")

E("10-b", "S2EE bridge",
  phase=P, priority="P2")
T("10-b1", "Server-side identity key storage (KMS adapter)", depends_on=["10-a1", "1-d4"],
  phase=P, priority="P2", parent_ref="10-b")
T("10-b2", "External email → group proxy bridge", depends_on=["10-b1", "3-c1"],
  phase=P, priority="P2", parent_ref="10-b")
T("10-b3", "S2EE modal warning when adding server-side identity", depends_on=["10-b1"],
  phase=P, priority="P2", parent_ref="10-b")

# ══════════════════════════════════════════════════════════════════════════
# Phase 11 — Cloud / SaaS Operations
# ══════════════════════════════════════════════════════════════════════════
P = "phase-11"

E("11-a", "SaaS provisioning & billing",
  phase=P, priority="P1")
T("11-a1", "Org signup flow — domain claim + DNS verification", depends_on=["4-b2"],
  phase=P, priority="P1", parent_ref="11-a")
T("11-a2", "Billing integration (Stripe)", depends_on=["11-a1"],
  phase=P, priority="P1", parent_ref="11-a")
T("11-a3", "Plan tiers — per-seat, storage, AI credits", depends_on=["11-a2"],
  phase=P, priority="P1", parent_ref="11-a")
T("11-a4", "Usage metering middleware (quotas per plan)", depends_on=["11-a3"],
  phase=P, priority="P1", parent_ref="11-a")
T("11-a5", "Invoice history & payment methods", depends_on=["11-a2"],
  phase=P, priority="P2", parent_ref="11-a")

E("11-b", "Superadmin console",
  phase=P, priority="P1")
T("11-b1", "Org management — list, create, suspend, delete tenants", depends_on=["1-d2"],
  phase=P, priority="P1", parent_ref="11-b")
T("11-b2", "Per-org usage dashboards", depends_on=["11-b1"],
  phase=P, priority="P1", parent_ref="11-b")
T("11-b3", "System-wide audit log", depends_on=["11-b1"],
  phase=P, priority="P2", parent_ref="11-b")
T("11-b4", "Global feature flags", depends_on=["11-b1"],
  phase=P, priority="P1", parent_ref="11-b")

E("11-c", "Multi-region operations",
  phase=P, priority="P2")
T("11-c1", "Read replicas in remote regions", depends_on=["2-a3"],
  phase=P, priority="P2", parent_ref="11-c")
T("11-c2", "Domain-based shard routing (federation protocol)", depends_on=["1-d3", "6-b3"],
  phase=P, priority="P2", parent_ref="11-c")
T("11-c3", "Cross-shard message delivery via webhook", depends_on=["11-c2"],
  phase=P, priority="P2", parent_ref="11-c")
T("11-c4", "Background job queue (Bull/BullMQ + Redis)", depends_on=["1-d1"],
  phase=P, priority="P1", parent_ref="11-c")

E("11-d", "Provider integration",
  phase=P, priority="P1")
T("11-d1", "AI provider — Bedrock, Vertex AI, Azure OpenAI adapters", depends_on=["1-d4"],
  phase=P, priority="P2", parent_ref="11-d")
T("11-d2", "Transactional email — SES, SendGrid adapters", depends_on=["1-d4"],
  phase=P, priority="P1", parent_ref="11-d")
T("11-d3", "KMS — AWS KMS, GCP Cloud KMS, Azure Key Vault", depends_on=["1-d4"],
  phase=P, priority="P2", parent_ref="11-d")
T("11-d4", "Queue — SQS, PubSub dead-letter adapters", depends_on=["1-d4"],
  phase=P, priority="P2", parent_ref="11-d")


# ══════════════════════════════════════════════════════════════════════════
# Key generation & YAML output
# ══════════════════════════════════════════════════════════════════════════

def build(output_path: str) -> None:
    # Generate keys — epics first so sub-tasks can reference them
    epics = [t for t in TASKS if t.task_type == "epic"]
    subtasks = [t for t in TASKS if t.task_type != "epic"]

    for t in epics + subtasks:
        while True:
            k = genkey.generate_key()
            if not any(t2.key == k for t2 in TASKS):
                t.key = k
                break

    # Build ref → key lookup
    ref_to_key = {t.ref: t.key for t in TASKS if t.key}

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(output_path, "w") as f:
        f.write(f"# generated: {now}\n")
        f.write(f"# source: build-tasks.py + gen-key.py\n")
        f.write("tasks:\n")

        for t in TASKS:
            if not t.key:
                continue

            f.write(f"\n  # — {t.key} —\n")
            f.write(f"  - key: {t.key}\n")
            f.write(f"    title: {t.title}\n")
            f.write(f"    type: {t.task_type}\n")
            f.write(f"    priority: {t.priority}\n")
            f.write(f"    status: todo\n")
            f.write(f"    phase: {t.phase}\n")
            f.write(f"    complexity: {t.complexity}\n")
            f.write(f"    loe: {t.loe}\n")

            if t.parent_ref:
                parent_key = ref_to_key.get(t.parent_ref)
                if parent_key:
                    f.write(f"    parent: {parent_key}\n")

            deps = [ref_to_key[d] for d in t.depends_on if d in ref_to_key]
            if deps:
                f.write(f"    depends_on:\n")
                for dk in deps:
                    f.write(f"      - {dk}\n")
            else:
                f.write(f"    depends_on: []\n")

    # Print summary
    epic_count = len(epics)
    task_count = len(subtasks)
    total_loe = sum(t.loe for t in TASKS)
    print(f"Wrote {output_path}")
    print(f"  {epic_count} epics, {task_count} tasks = {epic_count + task_count} total")
    print(f"  Total LOE: {total_loe}")
    print(f"  Phases: {sorted(set(t.phase for t in TASKS))}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Fuse task YAML")
    parser.add_argument("--out", default="fuse-tasks.yaml", help="Output YAML file")
    args = parser.parse_args()
    build(args.out)
