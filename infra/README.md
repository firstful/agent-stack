# Agent-Stack Controller

The controller (`controller.ts`) runs the reconciliation loop, HTTP API,
and Cloudflare Tunnel config generation.

## Change Detection (Hash-Based)

The controller determines rebuilds by comparing a combined hash across reconciliation
ticks (every 5s):

**`md5(configHash + repoHash)`**

- **configHash** — `md5` of the service's `agent-stack.json` (or `desired/<name>.json`).
  Always detected immediately when the file changes on disk.
- **repoHash** — hash of all files in the service repo directory. When
  `/srv/agent-stack/.git` exists (production path), the controller uses
  `git log -1 --format=%H -- repos/<service>/` — the latest commit hash for that
  subdirectory. When `.git` is absent, it falls back to a recursive `md5` of all
  files (excluding `node_modules` and dotfiles).

### Git-Aware Behavior

- **Uncommitted file edits do NOT trigger a rebuild.** The commit hash stays the
  same until `git commit` creates a new one.
- **After committing**, the next reconcile detects the new commit hash and
  rebuilds the container.
- **`agent-stack.json` edits always trigger a rebuild**, irrespective of commits,
  because the config hash changes on disk.
- **`.wip` file** in a service's repo root (`repos/<name>/.wip`) suppresses the
  repo hash component entirely (`""`), so only `agent-stack.json` edits cause a
  rebuild. Use this to batch commits and test before deploying.

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

### .WIP File

Create `/srv/agent-stack/infra/.WIP` to suppress both tests and restarts for
any file change. This is useful during active development:

```bash
touch /srv/agent-stack/infra/.WIP    # disable auto-restart
# ... make changes ...
rm /srv/agent-stack/infra/.WIP       # re-enable
```

When `.WIP` is present, the watcher returns immediately on any event — no
tests, no restart.

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
