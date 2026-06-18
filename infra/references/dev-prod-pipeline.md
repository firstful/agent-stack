# Dev/Prod Pipeline

Two independent agent-stack instances on separate machines, sharing a single git
monorepo via long-lived branches.

## Architecture

```
Dev machine (this host)                  Prod machine (remote host)
─────────────────────────                ──────────────────────────
Controller  ───  podman                  Controller  ───  podman
    │                                        │
cloudflared (dev tunnel)                  cloudflared (prod tunnel)
    │                                        │
*.dev.ffilt.us  →  slot-proxy             *.ffilt.us  →  slot-proxy
                        │                                       │
              fuse, engramic, ...                       fuse, engramic, ...
              (dev data / dev vault)              (prod data / prod vault)
```

Key properties:

| Aspect | Dev | Prod |
|--------|-----|------|
| Controller branch | `develop` | `main` |
| Hostnames | `*.dev.ffilt.us` | `*.ffilt.us` |
| Tunnel | Separate dev tunnel ID | Existing prod tunnel ID |
| Vault | Dev vault (dev credentials) | Prod vault (real credentials) |
| Data volumes | Independent dev data | Independent prod data |
| Port range | 4000–4999 (local host) | 4000–4999 (different host) |
| Public exposure | Yes (dev tunnel) | Yes (prod tunnel) |

The two controllers are **fully independent** — each writes its own
`/tmp/stack.*.chash` markers, its own `runtime/services.json`, and manages its
own podman containers and networks. Bridge `develop` → `main` to promote.

## Branch Strategy

```
main       ──  long-lived  ──  tracked by prod controller
develop    ──  long-lived  ──  tracked by dev controller
```

### What lives in each branch

| Layer | Same in both | Differs per branch |
|-------|-------------|-------------------|
| Controller code (`infra/`) | ✓ Identical (merged both ways) | — |
| Slot-proxy code | ✓ Identical | — |
| Containerfiles | ✓ Identical | — |
| Service source code | ✓ Identical | — |
| `agent-stack.json` expose hostnames | — | `fuse.dev.ffilt.us` / `fuse.ffilt.us` |
| `agent-stack.json` env vars | — | Different DB passwords, API keys, endpoints |
| Vault secrets | — | Resolved per machine by each vault |

### Keeping infra code in sync

Controller changes should be merged both ways:

```bash
# Pull prod infra fixes into dev
git checkout develop
git merge main --no-commit
git reset  # unstage all
git add infra/
git commit -m "sync: pull controller changes from main"

# Or the reverse — dev infra changes promoted to prod
git checkout main
git merge develop --no-commit
git reset
git add infra/
git commit -m "sync: pull controller changes from develop"
```

Only `infra/` is cherry-picked this way — service source and config stay on
their own branch.

## Hostname Scheme

- **Dev**: `<service>.dev.ffilt.us` — e.g. `fuse.dev.ffilt.us`, `engramic.dev.ffilt.us`
- **Prod**: `<service>.ffilt.us` — e.g. `fuse.ffilt.us`, `engramic.ffilt.us`

Set in each service's `agent-stack.json`:

```json
// develop branch
"expose": {
  "enabled": true,
  "hostname": "fuse.dev.ffilt.us"
}

// main branch
"expose": {
  "enabled": true,
  "hostname": "fuse.ffilt.us"
}
```

## Tunnel Setup

Each machine has its own cloudflared tunnel credential.

### Controller code changes (already applied)

Two env vars were added to `infra/lib/cloudflared.ts`:

- `TUNNEL_ID` — Override the tunnel UUID (default: reads from
  `agent-stack.json` or `"agent"`)
- `TUNNEL_DOMAIN` — Override the wildcard ingress hostname (default:
  `"*.ffilt.us"`)

### Dev machine systemd unit

Add to `/etc/systemd/system/agent-stack.service`:

```ini
Environment=TUNNEL_ID=<dev-tunnel-uuid>
Environment=TUNNEL_DOMAIN=*.dev.ffilt.us
```

### Prod machine systemd unit

Either unchanged (defaults work) or explicitly:

```ini
Environment=TUNNEL_ID=ca308a1b-557a-4a18-9350-6eec27465bdf
Environment=TUNNEL_DOMAIN=*.ffilt.us
```

### Tunnel setup steps (one-time)

1. In Cloudflare Zero Trust dashboard, create a new tunnel for dev
2. Copy the tunnel UUID to the dev machine's systemd unit
3. Install cloudflared on the dev machine with the dev tunnel credential
4. Create DNS record: `*.dev.ffilt.us` → dev tunnel

## Promotion Workflow

```bash
# 1. Iterate on dev
git checkout develop
# ... edit source code, configs, etc ...
git commit -m "feature: add widget"
git push origin develop
# → Dev controller detects change, builds, deploys on dev host

# 2. Test on dev
curl http://fuse.dev.ffilt.us/
# ... verify behaviour ...

# 3. Promote to prod
git checkout main
git merge develop
git push origin main
# → Prod controller detects merge, builds, deploys via blue-green

# 4. Verify on prod
curl https://fuse.ffilt.us/
```

### Rollback

```bash
git checkout main
git revert HEAD
git push origin main
# → Prod controller detects revert, rebuilds from previous state
```

## Unsolved Questions

### 1. Systemd services (appflowy, files)

Services defined with `"service": { "type": "simple" }` run as systemd units on
the host machine, not as podman containers. These services include `appflowy`
(Docker Compose) and `files` (Node.js server).

**Question:** How should these run on the prod machine?

- Option A: Containerise them (add Containerfile, switch to container mode)
- Option B: Create equivalent systemd units manually on the prod machine
- Option C: Run them on dev only, omit from prod

### 2. LLM endpoints and provider URLs

Several services reference `host.containers.internal` for LLM inference:

```json
"LLM_ENDPOINT": "http://host.containers.internal:8080/v1/chat/completions"  // groupthink
```

On dev this points to the local Hermes provider. On prod, this would need to
point to a production LLM endpoint — almost certainly a different machine or
service.

**Question:** Should these point to:
- A production LLM server on the prod machine's network?
- A remote API (OpenAI, Anthropic)?
- A dedicated inference container running on the prod stack?

### 3. Vault on the prod machine

Secrets are resolved via `{SECRETS.KEY}` → reading from a vault HTTP API.

**Question:** Does prod get:
- Its own vault instance with prod credentials?
- The same vault (this machine's vault) accessible over the network?
- No vault — secrets baked into `agent-stack.json` directly?

### 4. Schema migrations during blue-green

When a promotion includes a database schema change, the new slot must be
compatible with the old slot's data during the blue-green window. The safe
pattern is backward-compatible migrations (additive columns only).

**Question:** How are schema migrations managed?
- Part of the container startup (ORM auto-migrate)?
- Manual migration step before promotion?
- Separate migration-runner container?

### 5. Data volume initialisation for prod

On first prod deployment, every service starts with empty data volumes. Some
services (fuse, engramic, groupthink) need initial data — admin users,
seed content, database schemas.

**Question:** What's the initial data strategy for prod?
- Each service bootstraps itself on first start (schema creation, default admin)?
- Manual seed step after first deploy?
- Copy from dev (one-time)?

### 6. Keeping develop in sync with main

Infra changes (controller fixes, slot-proxy updates) happen on either branch.
Over time, the branches will diverge in ways that make merges painful.

**Question:** What's the sync cadence and workflow?
- Periodic `develop ← main` syncs for infra fixes?
- All infra changes land on `develop` and flow to `main` via merge?
- CI check that ensures infra/ is identical across branches?

### 7. Monitoring and alerting

Currently, there's no dashboard for the remote prod machine's status. If the
prod controller crashes or a service fails its slot swap, there's no
notification.

**Question:** Do we need:
- A health-check cron on this machine that polls the prod machine's status
  endpoint?
- The prod machine's dash exposed on a subdomain?
- Something else?

### 8. Config duplication friction

Every env var that differs between dev and prod must be maintained in two
places (two branches' `agent-stack.json` files). Adding a new env var means
adding it to both branches with potentially different values. This is the
primary maintenance cost of the branch approach.

**Question:** Is this acceptable, or should we support environment-specific
config overlays (e.g., `agent-stack.json` + `agent-stack.dev-override.json`)?
Currently the controller does not merge/override config files.

### 9. Rollback of data-breaking changes

If a promoted schema migration is backward-incompatible (rare but possible with
manual migration steps), rolling back the git commit won't fix the prod data.
The data volume has already been modified by the new schema.

**Question:** Do we need pre-promotion volume snapshots?
- Podman volume snapshot/restore scripts?
- Database-level backup before promotion?
- Accept the risk (promotions are gated by dev testing)?

### 10. `TUNNEL_ID` in branch configs

Currently, every exposed service's `agent-stack.json` carries the tunnel UUID:

```json
"expose": {
  "hostname": "fuse.ffilt.us",
  "tunnel": "ca308a1b-557a-4a18-9350-6eec27465bdf"
}
```

With two tunnels, this value differs per branch. The `TUNNEL_ID` env var was
added so the tunnel is a machine-level concern rather than per-service, but
each branch still needs the correct tunnel in case the env var is absent.

**Question:** Should we remove the per-service `tunnel` field entirely and rely
solely on the env var? This would clean up `agent-stack.json` but is a
backward-incompatible change for services that don't set `TUNNEL_ID`.
