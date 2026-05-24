#!/usr/bin/env python3
"""FUSE task analysis: priority breakdown, dep conflicts, test plans."""

def parse_yaml(path):
    with open(path) as f:
        lines = f.readlines()
    tasks, cur = [], None
    for line in lines:
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        if s.startswith('- key:'):
            if cur:
                tasks.append(cur)
            cur = {'key': s.split(': ', 1)[1], 'depends_on': []}
        elif cur and ': ' in s and not s.startswith('- '):
            k, v = s.split(': ', 1)
            cur[k] = v
        elif cur and s.startswith('- '):
            cur['depends_on'].append(s[2:])
    if cur:
        tasks.append(cur)
    for t in tasks:
        t['loe'] = int(t.get('loe', 0))
        t['complexity'] = int(t.get('complexity', 1))
    return tasks

tasks = parse_yaml('fuse-tasks.yaml')
by_key = {t['key']: t for t in tasks}
PRIO_ORDER = {'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}

# ── 1. BY PRIORITY ──
print('=' * 72)
print('  1. CARDS BY PRIORITY TIER')
print('=' * 72)
for pri in ['P0', 'P1', 'P2', 'P3']:
    pts = [t for t in tasks if t.get('priority') == pri]
    top = [t for t in pts if not t.get('parent')]
    subs = [t for t in pts if t.get('parent')]
    loe = sum(t['loe'] for t in pts)
    print(f'\n  {pri}  ({len(top)} top + {len(subs)} sub = {len(pts)} cards, {loe} LOE)')
    print(f'  {"─" * 60}')
    for t in sorted(top, key=lambda x: (-x['loe'], x['key'])):
        kids = [s for s in subs if s.get('parent') == t['key']]
        k = f' [{len(kids)} sub]' if kids else '        '
        subs_loe = sum(s['loe'] for s in kids)
        print(f'  {t["key"]:30s} LOE={t["loe"]:>2}  cx={t["complexity"]}  {t["type"]:5s}{k}  {t["title"][:44]}')

# ── 2. DEP CONFLICTS ──
print(f'\n\n{"=" * 72}')
print('  2. PRIORITY vs DEPENDENCY CONFLICTS')
print('=' * 72)
conflicts = []
for t in tasks:
    if t.get('parent'):
        continue
    mp = t.get('priority', 'P3')
    for dk in t.get('depends_on', []):
        d = by_key.get(dk)
        if d:
            dp = d.get('priority', 'P3')
            if PRIO_ORDER.get(mp, 4) < PRIO_ORDER.get(dp, 4):
                conflicts.append((t['key'], mp, dk, dp, t['title'][:50], d['title'][:50]))
if conflicts:
    conflicts.sort(key=lambda x: (PRIO_ORDER.get(x[1], 4), PRIO_ORDER.get(x[3], 4)))
    print(f'\n  {len(conflicts)} items with a higher-priority dep on a lower-priority card:\n')
    for c in conflicts:
        print(f'  ⚠  {c[0]:30s} ({c[1]})  depends on  {c[2]:30s} ({c[3]})')
        print(f'     {c[4]:60s}')
        print(f'     └─ {c[5]:60s}\n')
    print(f'  → In most cases this is benign: foundational P0/P1 work is a')
    print(f'    prerequisite for higher-priority features built on top.\n')
else:
    print('  ✓ No conflicts found.\n')

# ── 3. WORK CHUNKS ──
print(f'\n{"=" * 72}')
print('  3. WORK CHUNKS WITH TEST PLANS')
print('=' * 72)

CHUNKS = [
    ("CHUNK 1: Foundation & Core Infra", "P0", '''
Test Plan:
  ☐ make build produces a working Go binary
  ☐ docker run fuse starts with embedded SQLite (no external PG required)
  ☐ Health endpoint returns 200, readiness probe passes
  ☐ Postgres migrations run up/down/verify cleanly
  ☐ Structured logs emitted as JSON, Prometheus /metrics returns valid data
  ☐ Rate limiter rejects requests above configured threshold
  ☐ Feature flags toggle behavior at runtime without redeploy
  ☐ Backup: pg_dump → restore to fresh DB → all data intact
  ☐ Tracing: request spans visible in configured backend (Jaeger/Tempo)
  ☐ OpenAPI spec renders in Swagger UI, all endpoints documented
'''),
    ("CHUNK 2: Quickstart & Onboarding", "P0", '''
Test Plan:
  ☐ docker run fuse creates ephemeral @fuse.temp inbox
  ☐ Send email to ephemeral inbox → message appears in web UI
  ☐ Domain claim wizard: add DNS TXT → system verifies → domain activated
  ☐ Auto-SSL: Let's Encrypt cert provisioned automatically
  ☐ ARM64 docker image starts on Raspberry Pi 4/5
'''),
    ("CHUNK 3: SMTP Engine", "P0", '''
Test Plan:
  ☐ Maddy fork accepts SMTP on 25/587/465 with TLS
  ☐ EHLO response advertises FUSE capability keyword
  ☐ Message store: PG-backed mailbox survives restart
  ☐ Inbound routing: SMTP message → correct domain mailbox
  ☐ STARTFUSE command completes EHLO-style capability exchange
  ☐ Outbound fallback: message to non-FUSE domain sent via standard SMTP
  ☐ Legacy email rendered as visual "incoming mail" container in chat UI
  ☐ Per-domain TLS: each virtual domain serves its own certificate
  ☐ Integration test: send via Postfix → receive in FUSE web UI
'''),
    ("CHUNK 4: Auth & Identity", "P0", '''
Test Plan:
  ☐ Magic link: one-time token delivered by email, session created on click
  ☐ OAuth/SSO: Google, GitHub, Microsoft auth → session established
  ☐ OIDC: custom IdP (Keycloak/Auth0) works for enterprise tenants
  ☐ Identity types: human, agent, shared, service, guest creatable
  ☐ DNS TXT record verification proves domain ownership
  ☐ Session TTL enforced, refresh tokens rotate on use
'''),
    ("CHUNK 5: Chat Channels", "P0-P1", '''
Test Plan:
  ☐ Create public, private, DM, group DM channels with permission checks
  ☐ Cross-org channel creation (Trust Level 3+) across two servers
  ☐ Rich text: bold, italic, code, links, @mentions all render correctly
  ☐ Emoji reactions: add/remove, broadcast to all channel members
  ☐ Typing indicator: appears on keystroke, disappears after idle
  ☐ Notifications: per-channel mute, mentions-only, all-messages modes
  ☐ Slash commands: /poll, /todo, /schedule each create interactive content
  ☐ Message editing: history preserved, soft-delete with 30s undo
  ☐ Threaded replies render as nested tree with parent linking
  ☐ Pins, bookmarks, channel categories: create, list, remove
  ☐ Presence: online→away→DND→invisible, broadcast via WebSocket
'''),
    ("CHUNK 6: Team Identities & Modality Bridges", "P1-P2", '''
Test Plan:
  ☐ Team identity: create with owner + member roles, role enforcement
  ☐ Act-as: user switches to shared identity (e.g. @support), audit logged
  ☐ Multiple concurrent backers: two support agents both see the same queue
  ☐ Email↔chat bridge: inbound email → channel thread, channel reply → email
  ☐ Meeting↔chat bridge: transcription posted to linked channel in real-time
  ☐ Doc↔chat bridge: document changes trigger channel notification
  ☐ Canned responses: create/edit/delete snippets, insert into composer
  ☐ Manual task creation: any message flagged as actionable to-do
  ☐ AI agent: identity-type agent responds with configured custom instructions
'''),
    ("CHUNK 7: RICH_MAIL & Federation", "P1-P2", '''
Test Plan:
  ☐ RICH_MAIL frame: binary encode → decode → byte-identical round-trip
  ☐ Frame type registry: RICH_MAIL, PRESENCE, PING, CHANNEL, MEETING handled
  ☐ RFC5322 flatten: RICH_MAIL → plain email for legacy SMTP fallback
  ☐ STARTFUSE handshake: Server A → Server B, webhook endpoint exchanged
  ☐ Webhook push: Ed25519-signed delivery to remote server endpoint
  ☐ Webhook receive: verify X-Fuse-Signature, decrypt ECDH+AES payload
  ☐ Trust Levels 0→4: score increases on verified interactions, unlocks features
  ☐ DNS _fuse TXT record: publish → remote discovery → cache → use
  ☐ Exponential backoff: failed delivery retries at 2^n intervals, max N retries
  ☐ Per-domain multi-tenant: domain A data completely isolated from domain B
  ☐ Identity type policy: domain admin blocks/permits specific identity types
'''),
    ("CHUNK 8: Meetings & Voice", "P1-P3", '''
Test Plan:
  ☐ CalDAV: create event in Apple Calendar → appears in FUSE calendar
  ☐ CalDAV two-way: edit in FUSE → reflects in Thunderbird/Outlook
  ☐ RRULE: weekly recurring meeting syncs all occurrences
  ☐ LiveKit: create room → browser join → bidirectional AV stream
  ☐ Chat→meeting: /meet creates LiveKit room, posts join link
  ☐ Recording: start/stop via UI → MP4 file in object storage
  ☐ Transcription: speech→text→searchable transcript posted to channel
  ☐ Persistent voice: channel room stays open 24/7, join/leave at will
  ☐ Stage mode: speaker role has audio, audience listen-only, hand-raise to speak
  ☐ Push-to-talk: key-down activates mic, key-release mutes
  ☐ Screen sharing: presenter's screen visible to all participants
  ☐ Spatial audio: 3+ speakers positioned L/C/R in stereo field
  ☐ Cross-org voice: user from domain B joins domain A voice channel
  ☐ AI transcription bot: bot joins, live-transcribes to channel
'''),
    ("CHUNK 9: Document Store & Block Editor", "P1-P3", '''
Test Plan:
  ☐ TipTap renders empty doc, slash-command menu appears on /
  ☐ Block types: paragraph, heading, list, toggle, quote, code, table render
  ☐ Drag-and-drop: blocks reorder, parent-child tree stays consistent
  ☐ Page hierarchy: child pages with breadcrumb, sidebar navigation
  ☐ Comment threads: select text → add → reply → resolve
  ☐ Version history: auto-save → manual save → browse → restore
  ☐ Diff: side-by-side comparison highlights insertions/deletions
  ☐ 20+ block types: kanban, mermaid diagram, embed, equation functional
  ☐ Yjs collab: 2+ editors see each other's cursors, edits merge via CRDT
  ☐ Offline: edit while disconnected → auto-sync and merge on reconnect
  ☐ Database views: same data rendered as table, kanban, calendar, gallery
  ☐ Export: doc → markdown/HTML/PDF/JSON with full content fidelity
  ☐ Templates: meeting notes, ADR, postmortem, OKR insert structured blocks
  ☐ Channel-wiki: /docs/<channel-name> shows wiki for that channel
  ☐ Cross-org doc: share with external domain at Trust Level 4+
'''),
    ("CHUNK 10: Multi-Device, E2EE & Cross-Org", "P1-P3", '''
Test Plan:
  ☐ Multi-device: login on phone + laptop, both sessions active simultaneously
  ☐ Device revocation: revoke phone → phone API token immediately rejected
  ☐ E2EE identity key (Ed25519): generated on first login, stored in platform keychain
  ☐ E2EE group key (X25519): key exchange between two devices succeeds
  ☐ E2EE recovery: generate paper backup → recover account on new device
  ☐ Key publication: public key at /.well-known/fuse/keys, rotation with grace period
  ☐ Cross-org channel: domain A invites domain B user, admin approves/rejects
  ☐ Cross-org shared doc: permissions enforced by Trust Level
  ☐ Domain admin dashboard: trust levels, federation status, pending approvals
'''),
]

for name, pri, plan in CHUNKS:
    print(f'\n{"─" * 72}')
    print(f'  {name}')
    print(f'  Priority: {pri}')
    print(f'{"─" * 72}')
    print(plan)

# ── 4. SUMMARY ──
print(f'\n{"=" * 72}')
print('  SUMMARY')
print('=' * 72)
p_counts, p_loe = {}, {}
for t in tasks:
    p = t.get('priority', 'P3')
    p_counts[p] = p_counts.get(p, 0) + 1
    p_loe[p] = p_loe.get(p, 0) + t['loe']

print(f'\n  Total cards:      {len(tasks)}')
print(f'  Total LOE:        {sum(t["loe"] for t in tasks)}')
print(f'  Epics:            {sum(1 for t in tasks if t.get("type") == "epic")}')
print(f'  Sub-tasks:        {sum(1 for t in tasks if t.get("parent"))}')
print(f'  Dep conflicts:    {len(conflicts)}')
print(f'')
for p in ['P0', 'P1', 'P2', 'P3']:
    print(f'  {p:4s}  {p_counts.get(p, 0):>3} cards, {p_loe.get(p, 0):>4} LOE')
print(f'')
print(f'  P0 MVP LOE:       {p_loe.get("P0", 0):>4}')
print(f'  P1-P2 Beta LOE:   {p_loe.get("P1", 0) + p_loe.get("P2", 0):>4}')
print(f'  P3 Future LOE:    {p_loe.get("P3", 0):>4}')
print(f'{"=" * 72}')
