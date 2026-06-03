#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# rollback.sh — Rollback a failed Groupthink deployment
# ═══════════════════════════════════════════════════════════════════════════
#
# Reverts the Groupthink service to the previously running container image.
# The agent-stack controller uses a slot-swap (blue-green) deployment model:
#   - slot A and slot B alternate as active/idle
#   - On a failed deploy, the old slot is still intact and serving traffic
#   - This script orchestrates forcing the active slot back to the previous version
#
# Strategy:
#   1. If the new container is running but unhealthy → stop it, keep old active
#   2. If both containers are running (swap happened) → swap back to old slot
#   3. If only the new container exists (first deploy variant) → rebuild from git HEAD~1
#
# Environment variables:
#   SERVICE_NAME      — Container service name (default: groupthink)
#   REPO_DIR          — Path to the repo (default: /srv/agent-stack/repos/groupthink)
#   CONTROLLER_URL    — Agent-stack controller base URL (default: http://localhost)
#   DATABASE_ROLLBACK — Set to "true" to restore the last database backup too
#   BACKUP_FILE       — Specific backup file to restore (default: latest in /backups)
#
# Usage:
#   ./rollback.sh                          # Rollback container only
#   ./rollback.sh --db                     # Rollback container + database
#   ./rollback.sh --db --backup=/backups/groupthink-20260529-030000.sql.gz
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ──
SERVICE_NAME="${SERVICE_NAME:-groupthink}"
REPO_DIR="${REPO_DIR:-/srv/agent-stack/repos/groupthink}"
CONTROLLER_URL="${CONTROLLER_URL:-http://localhost}"
DATABASE_ROLLBACK="${DATABASE_ROLLBACK:-false}"
BACKUP_FILE="${BACKUP_FILE:-}"

# ── Flags ──
DO_DB=false
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DO_DB=true ;;
    --backup=*) BACKUP_FILE="${1#*=}" ;;
    --help) echo "Usage: $0 [--db] [--backup=<file>]"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── Logging ──
log() { echo "[rollback] $(date -Iseconds) $*"; }
err() { echo "[rollback] ERROR $(date -Iseconds) $*" >&2; }

# ── Step 1: Determine current state ──
log "checking current deployment state for ${SERVICE_NAME}..."

# Fetch service status from controller
SERVICE_JSON=$(curl -sf "${CONTROLLER_URL}/api/services/${SERVICE_NAME}" 2>/dev/null || echo "")

if [ -z "$SERVICE_JSON" ]; then
  err "cannot fetch service state from controller at ${CONTROLLER_URL}"
  err "falling back to direct Podman inspection..."

  # Direct Podman check (run as reeds user if running rootless)
  if command -v podman &>/dev/null; then
    PODMAN="podman"
  elif command -v sudo &>/dev/null && sudo -u reeds podman ps &>/dev/null 2>&1; then
    PODMAN="sudo -u reeds podman"
  else
    err "cannot reach controller or Podman — aborting"
    exit 1
  fi

  log "using direct Podman management via: ${PODMAN}"

  # Check what containers exist
  CONTAINERS=$($PODMAN ps -a --filter "name=${SERVICE_NAME}" --format "{{.Names}} {{.Status}}" 2>/dev/null || true)

  if echo "$CONTAINERS" | grep -q "${SERVICE_NAME}--b"; then
    log "slot-b exists — rolling back to slot-a"
    $PODMAN stop "${SERVICE_NAME}--b" 2>/dev/null || true
    $PODMAN rm "${SERVICE_NAME}--b" 2>/dev/null || true
    log "old slot-b stopped and removed"
  fi

  if echo "$CONTAINERS" | grep -q "${SERVICE_NAME}--a"; then
    log "restarting slot-a..."
    $PODMAN start "${SERVICE_NAME}--a" 2>/dev/null || true
  else
    err "no existing containers found for ${SERVICE_NAME}"
    log "attempting rebuild from git HEAD~1..."
    cd "$REPO_DIR"
    PREV_HASH=$(git rev-parse HEAD~1 2>/dev/null || echo "")
    if [ -n "$PREV_HASH" ]; then
      git checkout "$PREV_HASH" -- .
      log "checked out ${PREV_HASH}"
      log "triggering rebuild via controller..."
      curl -sf -X POST "${CONTROLLER_URL}/api/services/${SERVICE_NAME}/rebuild" || true
    else
      err "no previous commit to roll back to"
      exit 1
    fi
  fi

  log "container rollback complete — verify with: ${PODMAN} ps"
  exit 0
fi

# ── Controller-assisted rollback ──
log "controller is reachable — using API-assisted rollback"

ACTIVE_SLOT=$(echo "$SERVICE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
active = data.get('activeSlot', 'a')
slots = data.get('slots', {})
slots_a = slots.get('a', {}).get('running', False)
slots_b = slots.get('b', {}).get('running', False)
print(f'slot_a_running={slots_a} slot_b_running={slots_b} active={active}')
" 2>/dev/null || echo "active=a slot_a_running=true slot_b_running=false")

eval "$ACTIVE_SLOT"

log "active slot: ${active}, slot-a running: ${slot_a_running}, slot-b running: ${slot_b_running}"

if [ "$active" = "b" ] && [ "$slot_a_running" = "True" ]; then
  # Swap back: B is active but A is still running → promote A back
  log "swap detected — swapping back to slot-a..."
  curl -sf -X POST "${CONTROLLER_URL}/api/services/${SERVICE_NAME}/restart" || {
    log "controller restart API unavailable — manual intervention needed"
    err "MANUAL: run: sudo -u reeds podman stop ${SERVICE_NAME}--b && sudo -u reeds podman rm ${SERVICE_NAME}--b"
    err "MANUAL: then: sudo -u reeds podman start ${SERVICE_NAME}--a"
    log "or rebuild the previous version: curl -X POST ${CONTROLLER_URL}/api/services/${SERVICE_NAME}/rebuild"
  }
elif [ "$active" = "a" ] && [ "$slot_a_running" = "True" ]; then
  # A is active and running — just trigger a rebuild from the previous git commit
  log "active slot is running the current version — rebuilding from git HEAD~1..."
  cd "$REPO_DIR"
  PREV_HASH=$(git rev-parse HEAD~1 2>/dev/null || echo "")
  if [ -n "$PREV_HASH" ]; then
    git checkout "$PREV_HASH" -- .
    log "checked out ${PREV_HASH}"
    curl -sf -X POST "${CONTROLLER_URL}/api/services/${SERVICE_NAME}/rebuild" || true
  else
    err "no previous commit to roll back to"
    log "rebuilding current version as fallback..."
    curl -sf -X POST "${CONTROLLER_URL}/api/services/${SERVICE_NAME}/rebuild" || true
  fi
else
  err "unexpected state: active=$active slot_a=$slot_a_running slot_b=$slot_b_running"
  log "triggering full rebuild as fallback..."
  curl -sf -X POST "${CONTROLLER_URL}/api/services/${SERVICE_NAME}/rebuild" || true
fi

log "container rollback initiated"

# ── Step 2: Database rollback (optional) ──
if [ "$DO_DB" = "true" ] || [ "$DATABASE_ROLLBACK" = "true" ]; then
  log "=== Database Rollback ==="

  # Find the latest backup
  if [ -z "$BACKUP_FILE" ]; then
    BACKUP_DIR="${BACKUP_DIR:-/backups}"
    BACKUP_FILE=$(ls -t "${BACKUP_DIR}/groupthink-"*.sql.gz 2>/dev/null | head -1 || echo "")
  fi

  if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    err "no backup file found to restore from"
    log "database rollback SKIPPED — restore manually from a known-good backup"
    log "  pg_restore -h <host> -U groupthink -d groupthink --clean <backup-file>"
    exit 1
  fi

  log "restoring from backup: ${BACKUP_FILE}"

  # Parse DB connection params (from agent-stack.json or environment)
  DB_HOST="${PGHOST:-groupthink--db}"
  DB_PORT="${PGPORT:-5432}"
  DB_USER="${PGUSER:-groupthink}"
  DB_NAME="${PGDATABASE:-groupthink}"
  export PGPASSWORD="${PGPASSWORD:-groupthink}"

  # STOP the application first to prevent writes during restore
  log "stopping application container..."
  if [ -n "$PODMAN" ]; then
    $PODMAN stop "${SERVICE_NAME}--a" 2>/dev/null || true
    $PODMAN stop "${SERVICE_NAME}--b" 2>/dev/null || true
  fi

  log "running pg_restore (this may take a while)..."
  if pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" \
    -d "$DB_NAME" --clean --if-exists --no-owner \
    "$BACKUP_FILE" 2>&1; then
    log "database restored successfully from ${BACKUP_FILE}"
  else
    err "pg_restore failed — database may be in inconsistent state"
    err "restore manually: pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --clean $BACKUP_FILE"
  fi

  log "restarting application container..."
  if [ -n "$PODMAN" ]; then
    $PODMAN start "${SERVICE_NAME}--a" 2>/dev/null || true
  fi
  log "triggering controller reconciliation..."
  curl -sf -X POST "${CONTROLLER_URL}/api/reconcile" || true
fi

log "rollback complete — verify with: curl http://localhost/health/ready"
log "if issues persist, check container logs: sudo -u reeds podman logs ${SERVICE_NAME}--a"
