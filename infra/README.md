# Agent-Stack Controller

The controller (`controller.ts`) runs the reconciliation loop, HTTP API,
and Cloudflare Tunnel config generation.

## Architecture Overview

The agent-stack controller manages two types of services:

- **Container services**: Defined by `agent-stack.json` files inside each
  `repos/<name>/` directory. The controller builds podman images from
  Dockerfiles, deploys them with blue-green slot swaps, and exposes them
  via Cloudflare Tunnel.
- **Systemd services**: Defined by `desired/<name>.json` files. The controller
  generates systemd unit files and manages their lifecycle via `systemctl`.

On a reconciliation tick (every 5s), the worker thread:
1. Loads the desired service set from config files
2. Garbage-collects containers and systemd units no longer in the set
3. Builds and deploys any changed services using slot-swap for zero downtime
4. Writes the cloudflared tunnel config for exposed services
5. Persists runtime state for the HTTP API

## Directory Structure

```
infra/                   ← Controller source code
├── controller.ts        ← HTTP server + route dispatch + worker spawner
├── reconcile-worker.ts  ← Background worker thread (5s tick)
├── lib/                 ← Modular helper libraries
│   ├── config.ts        ← Paths, constants, naming helpers
│   ├── services.ts      ← Desired state loading, hashing, git clone management
│   ├── reconcile.ts     ← Container build/deploy/slot-swap orchestration
│   ├── podman.ts        ← Podman CLI wrappers (build, run, inspect, network)
│   ├── cloudflared.ts   ← Cloudflare Tunnel config generation & restart
│   ├── runtime.ts       ← Runtime state persistence (services.json)
│   ├── sidecar.ts       ← Sidecar container lifecycle management
│   ├── systemd.ts       ← Systemd unit creation/removal/status
│   ├── routes.ts        ← Declarative REST API route table + OpenAPI spec
│   ├── perf.ts          ← Performance metrics collection & history
│   └── types.ts         ← TypeScript interfaces & type definitions
├── controller.log       ← Log file (auto-rotated on restart)
├── .sudo-password.txt   ← Sudo password for systemd operations
├── .password.txt        ← Admin password for /sudo endpoint
├── package.json
└── README.md            ← This file

## Change Detection (Commit-Based)

The controller rebuilds a container when a new git commit touches the service's
repo subdirectory. The hash marker (`/tmp/stack.<name>.hash`) stores the commit
hash from `git log -1 --format=%H -- repos/<service>/`. On each reconciliation
tick (every 5s) it compares — any change triggers a rebuild.

- **Only committed changes trigger a rebuild.** Uncommitted edits are ignored.
- When a rebuild is needed, the controller creates a limited checkout at
  `/srv/clones/<name>/<hash>/` using `git archive` of just that subdirectory,
  builds the container image from the checkout, and blue-green deploys via
  slot swap.
- The built image gets a `stack.commit=<hash>` label for traceability.
- If `/srv/agent-stack/.git` is absent, it falls back to a recursive `md5` of
  all files (excluding `node_modules` and dotfiles).

### Port Allocation

For container services with `auto_port: true`, each slot (a/b) gets its own port
from the `AUTO_PORT_START`–`AUTO_PORT_END` range (default 4000–4999). See
`lib/config.ts`.

## Auto-Restart Behavior

The controller uses `fs.watch` on its own source directory (`lib/`). When a
`.ts`, `.js`, or `.json` file changes, it schedules a restart after a 1-second
debounce.

### Test Gate

Before restarting, the watcher runs the test suite. If any test fails, the
restart is canceled and the old process keeps running:

```
[watch] config.ts modified — running tests...
[watch] tests passed — restarting
```

or:

```
[watch] reconcile.ts modified — running tests...
[watch] tests FAILED — canceled
```

## Running Tests

```bash
# Fast — pure-function tests only (config, routes, sidecar, services)
npm test

# Runtime test — needs separate process for env setup
npm run test:runtime

# All tests
npm run test:all

# Type check
npm run typecheck
```

The runtime test runs in a separate process because it needs to set
`STACK_RUNTIME_DIR` before the module is loaded. It creates and destroys a
temp directory for each run.

## Test Files

| File | Tests | Depends on |
|------|-------|------------|
| `lib/config.test.ts` | Slot/sidecar naming, markers, constants | Nothing |
| `lib/routes.test.ts` | Route matching, OpenAPI spec | Nothing |
| `lib/sidecar.test.ts` | Sidecar config shapes, naming | Nothing |
| `lib/services.test.ts` | hashDir, resolveSecrets, loadDesired shape | Real repos dir |
| `lib/runtime.test.ts` | writeRuntimeState output structure | Temp dir via env var |

## Adding a New Test

1. Create `lib/<module>.test.ts` using `node:test` and `node:assert`
2. Add its path to the `"test"` script in `package.json` and to
   `runTests()` in `controller.ts`
3. For tests needing special env setup, add a separate `"test:<name>"`
   script instead

## Sidecars

Services can define sidecar containers for infrastructure dependencies
(DBs, caches, etc.). See `lib/types.ts` `SidecarConfig` for the schema.

Sidecar lifecycle is managed via `lib/sidecar.ts`. They are created before
the primary container, stopped after, and tracked in the runtime state under
the `sidecars` key.

## Adding a Lib Module

1. Create `lib/<name>.ts` with a clearly named export. Follow the conventions:
   - `// ── Section Name ──` dividers between logical groups
   - `/** JSDoc */` above every exported function
   - Use `import type` for type-only imports
2. Create `lib/<name>.test.ts` using `node:test` and `node:assert`
3. Add its path to both `"test"` scripts in `package.json`
4. Import and wire it into `controller.ts` or `reconcile-worker.ts` as needed
5. If the module needs path/constant configuration, add defaults to `config.ts`

See `lib/runtime.ts` (~202 lines) for a minimal module example, or `lib/sidecar.ts` (~159 lines) for a medium-complexity module with lifecycle, cleanup, and tests.
