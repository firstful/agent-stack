# Repo: opencode

## Service Config

Desired state: `/srv/agent-stack/desired/opencode.json`

## Containerfile

This repo contains a `Containerfile` that builds the image `stack/opencode:latest`.

The `APP_PORT` env var (set in desired config) controls which port the server listens on.

## Deployment Workflow

1. **Make changes** to this repo (Containerfile, source code, etc.)
2. **Create `.wip`** at the repo root to block auto-rebuilds:
   ```
   touch /srv/agent-stack/repos/opencode/.wip
   ```
3. Test your changes locally inside the running container if needed
4. **Remove `.wip`** when ready to deploy:
   ```
   rm /srv/agent-stack/repos/opencode/.wip
   ```
   The controller will detect the change within 5 seconds, rebuild the image, and recreate the container.

## Wiki

A shared project wiki is maintained at `/wiki` (mounted from `/srv/agent-stack/config/wiki/` on the host). This is a read-write directory — any coding agent can read or update wiki pages. Use it to document:

- System architecture and design decisions
- Operational procedures and runbooks
- Ongoing work, known issues, and gotchas
- Anything useful that doesn't fit in a config file

Wiki pages are plain Markdown (.md) files. Create or update them as needed. When starting a task, check `/wiki` first for relevant context.

## Config Changes

To change ports, volumes, env vars, or expose settings, edit `/srv/agent-stack/desired/opencode.json` directly — this always triggers a container recreation (no `.wip` needed).

## Dispatching Tasks to Other Agents

A routing service runs on the host at `http://host.containers.internal:7979`. Use it to delegate work to kilocode, kiro, or gemini — whichever is available and not rate-limited.

**Dispatch a task** (returns immediately with a task ID):
```bash
curl -s -X POST http://host.containers.internal:7979/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"dir": "/host/srv/agent-stack/repos/opencode", "task": "your task here"}'
# → {"task_id": "aC3eF6g"}
```

Note: prefix the working directory with `/host` — the service strips it before passing to the agent on the host filesystem.

**Check status**:
```bash
curl -s http://host.containers.internal:7979/poll/aC3eF6g
# → {"status": "done", "agent": "kilocode"}
```

**Wait for result** (blocks until complete, returns output):
```bash
curl -s http://host.containers.internal:7979/wait/aC3eF6g
# → {"output": "..."}
```

**Search past task outputs**:
```bash
curl -s http://host.containers.internal:7979/grep/somepattern
```

Agents are tried in order: kilocode → kiro → gemini. If one hits a rate limit it goes on a 10-minute cooldown and the next is tried. If all are on cooldown, dispatch returns an error.
