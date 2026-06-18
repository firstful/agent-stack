# Dev/Prod Pipeline

Two independent agent-stack instances on separate machines, sharing a single git
monorepo. Per-environment configuration (hostnames, env vars, secrets) is
managed by Terraform, not by branching.

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
| Config source | Terraform workspace `dev` | Terraform workspace `prod` |
| Hostnames | `*.dev.ffilt.us` | `*.ffilt.us` |
| Tunnel | Separate dev tunnel ID | Existing prod tunnel ID |
| Vault | Dev vault (dev credentials) | Prod vault (real credentials) |
| Data volumes | Independent dev data | Independent prod data |
| Port range | 4000–4999 (local host) | 4000–4999 (different host) |
| Public exposure | Yes (dev tunnel) | Yes (prod tunnel) |

The two controllers are **fully independent** — each writes its own
`/tmp/stack.*.chash` markers, its own `runtime/services.json`, and manages its
own podman containers and networks. Config is applied per environment via
Terraform workspaces or variable files.

## Configuration Strategy

Per-environment configuration is managed by Terraform, not by git branches.
There is a single long-lived branch (`main`). The environment difference is
handled by Terraform workspaces or variable files.

### Directory structure

```
infra/terraform/
├── environments/
│   ├── dev/                    # Dev machine variables
│   │   └── terraform.tfvars
│   └── prod/                   # Prod machine variables
│       └── terraform.tfvars
├── templates/                   # agent-stack.json template files
│   ├── fuse.json.tftpl
│   ├── engramic.json.tftpl
│   ├── jerrymapping.json.tftpl
│   ├── ...
├── main.tf                      # Template rendering + output
├── variables.tf
└── versions.tf
```

### How it works

Each service has a `.tftpl` template of its `agent-stack.json` with
environment-specific values as template variables:

```json
// infra/terraform/templates/fuse.json.tftpl
{
  "name": "fuse",
  "container": {
    "port": 3000,
    "auto_port": true,
    "env": {
      "FUSE_DOMAIN": "${domain_prefix}fuse.${domain_suffix}",
      "DATABASE_URL": "postgresql://fuselocal:${db_password}@fuse--db:5432/fuse",
      "SESSION_SECRET": "${session_secret}",
      "JWT_SECRET": "${jwt_secret}"
    },
    "sidecars": [
      {
        "name": "db",
        "image": "docker.io/postgres:16-alpine",
        "env": {
          "POSTGRES_PASSWORD": "${db_password}"
        }
      }
    ]
  },
  "expose": {
    "enabled": true,
    "hostname": "${domain_prefix}fuse.${domain_suffix}"
  }
}
```

Environment variables define the values per workspace:

```hcl
// infra/terraform/environments/dev/terraform.tfvars
domain_prefix = ""
domain_suffix = "dev.ffilt.us"
db_password   = "dev-password-local"
session_secret = "dev-session-secret-value"
jwt_secret     = "dev-jwt-secret-value"
```

```hcl
// infra/terraform/environments/prod/terraform.tfvars
domain_prefix = ""
domain_suffix = "ffilt.us"
db_password   = "prod-db-password-here"
session_secret = "prod-session-secret"
jwt_secret     = "prod-jwt-secret"
```

### Applying

```bash
# Apply dev config (writes to repos/fuse/agent-stack.json on this machine)
cd infra/terraform
terraform apply --var-file=environments/dev/terraform.tfvars

# Apply prod config (writes to repos/fuse/agent-stack.json on prod machine)
# Either run from the prod machine, or run from here with remote state
ssh prod-machine "cd /srv/agent-stack/infra/terraform && terraform apply --var-file=environments/prod/terraform.tfvars"
```

### How the controller picks up changes

Terraform writes `repos/<name>/agent-stack.json` directly. The controller
detects this through its **git-ref-watch** (if a git commit wraps the apply) or
its **safety-net heartbeat** (every 5 minutes, catches any file change).

For immediate reconciliation after `terraform apply`, trigger the controller
API:

```bash
curl -X POST http://localhost/api/reconcile   # local
ssh prod-machine "curl -X POST http://localhost/api/reconcile"  # remote
```

Alternatively, Terraform can commit and push the generated files:

```bash
terraform apply --var-file=environments/dev/terraform.tfvars
git add repos/*/agent-stack.json
git commit -m "config: update env vars for fuse"
git push
# → Controller detects git commit within 5s via ref-watch
```

### What Terraform does NOT manage

| Concern | Handled by | Why |
|---------|-----------|-----|
| Source code changes | Controller (git-ref-watch) | Terraform only writes agent-stack.json |
| Container images | Controller (podman build) | Builds from Containerfile + source |
| Blue-green swaps | Controller (reconcile.ts) | Zero-downtime slot swap logic |
| Health checks | Controller (waitForHealthy) | After each slot swap |
| Runtime state | Controller (writeRuntimeState) | Local to each machine |
| Cloudflare tunnel config | Controller (cloudflared.ts) | Generated from TUNNEL_ID/TUNNEL_DOMAIN env vars |

### Secret management

Credentials that differ per environment should use the existing
`{SECRETS.KEY}` pattern. The `agent-stack.json` template contains
`{SECRETS.SOME_KEY}` placeholders, and each machine's vault resolves them
locally.

Secrets that are already in template variables (like `db_password` above) are
rendered by Terraform directly into the JSON. Which values go in templates vs
vault is a judgement call:

- **In templates** (rendered by Terraform): Environment-specific but
  low-sensitivity values (hostnames, domain suffixes, test passwords)
- **In vault** (resolved at runtime): Production credentials, API keys,
  session secrets — values that should not live in any `.tfvars` file committed
  to git

## Hostname Scheme

- **Dev**: `<service>.dev.ffilt.us` — e.g. `fuse.dev.ffilt.us`, `engramic.dev.ffilt.us`
- **Prod**: `<service>.ffilt.us` — e.g. `fuse.ffilt.us`, `engramic.ffilt.us`

Set via Terraform template variables in `infra/terraform/environments/*/terraform.tfvars`:

```hcl
# dev
domain_suffix = "dev.ffilt.us"

# prod
domain_suffix = "ffilt.us"
```

The template renders the hostname as `"${domain_prefix}<service>.${domain_suffix}"`.

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
# Edit source code in repos/<service>/ or update templates in infra/terraform/
terraform apply --var-file=infra/terraform/environments/dev/terraform.tfvars
git add repos/*/agent-stack.json infra/terraform/
git commit -m "feat: add widget to fuse"
git push
# → Dev controller detects git commit, builds, deploys on dev host

# 2. Test on dev
curl http://fuse.dev.ffilt.us/
# ... verify behaviour ...

# 3. Promote to prod
terraform apply --var-file=infra/terraform/environments/prod/terraform.tfvars
# If running locally against prod's git checkout:
git add repos/*/agent-stack.json
git commit -m "promote: fuse widget to prod"
git push
# Or if running directly on the prod machine:
ssh prod-machine "cd /srv/agent-stack && git pull && curl -X POST http://localhost/api/reconcile"

# 4. Verify on prod
curl https://fuse.ffilt.us/
```

### What gets promoted

| Artifact | Mechanism | Cadence |
|----------|-----------|---------|
| Source code changes | `git push` → controller rebuilds on each machine | Every commit |
| Config/hostname changes | `terraform apply` with prod vars | On promotion |
| Secret rotation | Update vault on prod machine | Independent of code |
| Container images | Rebuilt from source by each controller | Per deployment |

## Unsolved Questions

### 1. Systemd services (appflowy, files) — RESOLVED

**Decision:** These stay on dev only. The prod machine runs only
container-based services. No systemd units, no Docker Compose, no Node.js file
server.

Services defined with `"service": { "type": "simple" }` (`appflowy`, `files`)
are excluded from the prod Terraform workspace — their templates either don't
exist or produce `agent-stack.json` with `"expose": { "enabled": false }`.

### 2. LLM endpoints and provider URLs — DEFERRED

**Decision:** Ignored for now. The `host.containers.internal:8080` references
stay as-is in both environments. On prod, those service features will simply
not function until a production LLM endpoint is wired in.

```json
"LLM_ENDPOINT": "http://host.containers.internal:8080/v1/chat/completions"
```

When prod needs LLM access, the endpoint will be updated in the prod
`terraform.tfvars` to point at whatever serves it (dedicated inference
container, remote API, etc.).

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

### 6. Config drift between environments

With a single branch and environment-specific `terraform.tfvars` files, there's
no mechanism to enforce that a template variable exists in both environments.
It's possible to add `"NEW_VAR": "${new_var}"` to a template, fill it in
`dev/terraform.tfvars`, and forget to add it to `prod/terraform.tfvars`.
Terraform will prompt for a value on apply, but only if you're in a TTY.

**Question:** How do we prevent prod from silently getting a placeholder or
empty value?

- CI check that validates all vars are defined across all environment files?
- Terraform validation block for required variables?
- Schema validation of the rendered JSON before apply?

### 7. Terraform state management

Terraform state must be shared or at least consistent when applying from
separate machines.

**Question:** Where does Terraform state live?

- Local state per machine (no sharing — each machine applies independently)?
- Remote state in S3/GCS/Consul (shared between machines)?
- Git-managed state (committed to repo)?

If state is per-machine, each machine applies independently and they never
conflict. If state is shared, you need a remote backend and locking.

### 8. Monitoring and alerting

Currently, there's no dashboard for the remote prod machine's status. If the
prod controller crashes or a service fails its slot swap, there's no
notification.

**Question:** Do we need:
- A health-check cron on this machine that polls the prod machine's status
  endpoint?
- The prod machine's dash exposed on a subdomain?
- Something else?

### 9. Rollback of data-breaking changes

If a promoted schema migration is backward-incompatible (rare but possible with
manual migration steps), rolling back the git commit won't fix the prod data.
The data volume has already been modified by the new schema.

**Question:** Do we need pre-promotion volume snapshots?
- Podman volume snapshot/restore scripts?
- Database-level backup before promotion?
- Accept the risk (promotions are gated by dev testing)?

### 10. Controller reconciliation vs Terraform file writes

Terraform writes `agent-stack.json` files directly to disk. The controller's
primary trigger is git-ref-watch (polling `.git/HEAD` every 5s). If Terraform
writes files without a corresponding git commit, the controller won't detect
the change until the 5-minute safety-net heartbeat fires.

**Question:** What's the trigger strategy?

- Always commit after `terraform apply` (git commit + push → 5s detection)
- Use `POST /api/reconcile` after each apply (instant, but needs local access)
- Accept the 5-minute delay (heartbeat catches it) — fine for non-urgent changes
- Something else?
