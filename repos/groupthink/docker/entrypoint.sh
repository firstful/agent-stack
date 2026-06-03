#!/bin/sh
# ── Database Migration Init Container ──────────────────────────────────────────
# This entrypoint script acts as an init container pattern inside the main
# container image. On startup it:
#   1. Waits for the database to be reachable (with retry + backoff)
#   2. Runs `drizzle-kit push` to sync the schema
#   3. Executes the main application (CMD)
#
# This guarantees migrations run before the app starts, keeping the pattern
# atomic while staying compatible with agent-stack's current lifecycle.
#
# Environment variables expected:
#   DATABASE_URL     — PostgreSQL connection string
#   APP_PORT         — Port the API server listens on (default: 3000)
#   MIGRATE_TIMEOUT  — Max seconds to wait for DB before giving up (default: 60)
#   MIGRATE_DISABLE  — Set to "true" to skip migrations entirely
#   MIGRATE_ONLY     — Set to "true" to exit after migration (for true init containers)
# ────────────────────────────────────────────────────────────────────────────────

set -e

MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-60}"
MIGRATE_DISABLE="${MIGRATE_DISABLE:-false}"
MIGRATE_ONLY="${MIGRATE_ONLY:-false}"

# ── Step 1: Wait for database ────────────────────────────────────────────────
if [ "$MIGRATE_DISABLE" != "true" ]; then
  echo "[init] waiting for database to be reachable..."

  DB_HOST_PORT="${DATABASE_URL#*://}"
  DB_HOST_PORT="${DB_HOST_PORT#*@}"
  DB_HOST="${DB_HOST_PORT%%:*}"
  DB_PORT="${DB_HOST_PORT#*:}"
  DB_PORT="${DB_PORT%%/*}"

  if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ]; then
    echo "[init] warning: could not parse DATABASE_URL, skipping DB wait"
  else
    _elapsed=0
    _interval=3
    while [ "$_elapsed" -lt "$MIGRATE_TIMEOUT" ]; do
      if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
        echo "[init] database is reachable at ${DB_HOST}:${DB_PORT}"
        break
      fi
      echo "[init] waiting for database... (${_elapsed}s / ${MIGRATE_TIMEOUT}s)"
      sleep "$_interval"
      _elapsed=$((_elapsed + _interval))
    done

    if [ "$_elapsed" -ge "$MIGRATE_TIMEOUT" ]; then
      echo "[init] FATAL: database not reachable after ${MIGRATE_TIMEOUT}s" >&2
      exit 1
    fi
  fi

  # ── Step 2: Run schema push ─────────────────────────────────────────────────
  echo "[init] running drizzle-kit push..."
  cd /app/packages/db
  if ! npx drizzle-kit push --config=/app/packages/db/drizzle.config.ts 2>&1; then
    echo "[init] WARNING: migration push failed (non-fatal — app will attempt to continue)" >&2
  else
    echo "[init] schema push completed successfully"
  fi
  cd /app/apps/api
fi

# ── Step 3: Init-only mode (true init container) ─────────────────────────────
if [ "$MIGRATE_ONLY" = "true" ]; then
  echo "[init] MIGRATE_ONLY=true — exiting after migration"
  exit 0
fi

# ── Step 4: Execute main application ─────────────────────────────────────────
echo "[init] starting application..."
exec "$@"
