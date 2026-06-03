#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# pg-backup.sh — Postgres backup script for Groupthink
# ═══════════════════════════════════════════════════════════════════════════
#
# Dumps the Groupthink database to a compressed archive using pg_dump.
# Supports three storage backends:
#   1. Local volume  — BACKEND=volume (default), dumps to BACKUP_DIR
#   2. S3-compatible — BACKEND=s3, uploads via aws CLI
#
# Environment variables (set in agent-stack.json or cron env):
#   BACKEND          — "volume" or "s3" (default: volume)
#   BACKUP_DIR       — local path for volume backend (default: /backups)
#   DATABASE_URL     — Postgres connection string (required)
#   PG_HOST          — Postgres host (default: extracts from DATABASE_URL)
#   PG_PORT          — Postgres port (default: 5432)
#   PG_USER          — Postgres user (default: groupthink)
#   PG_DATABASE      — Database name (default: groupthink)
#   PGPASSWORD       — Postgres password (default: groupthink)
#   S3_BUCKET        — S3 bucket path for s3 backend (required if S3 backend)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — S3 credentials
#   RETENTION_DAYS   — Number of days to keep backups (default: 30)
#   BACKUP_NOTIFY_URL— Optional webhook URL to notify on failure
#
# Output: Creates a compressed dump at:
#   volume: BACKUP_DIR/groupthink-YYYYMMDD-HHMMSS.sql.gz
#   s3:     s3://BUCKET/groupthink/YYYYMMDD-HHMMSS.sql.gz
#
# Cron schedule: daily at 03:00 (systemd timer or cron job)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Config ──
BACKEND="${BACKEND:-volume}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PG_HOST="${PG_HOST:-groupthink--db}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-groupthink}"
PG_DATABASE="${PG_DATABASE:-groupthink}"
PGPASSWORD="${PGPASSWORD:-groupthink}"
PGPASSWORD="${PGPASSWORD:-groupthink}"

# Parse DATABASE_URL if set
if [ -n "${DATABASE_URL:-}" ]; then
  # Extract host:port from connection string
  PG_HOST="${PG_HOST:-$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')}"
  PG_PORT="${PG_PORT:-$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')}"
  PG_USER="${PG_USER:-$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')}"
  PG_DATABASE="${PG_DATABASE:-$(echo "$DATABASE_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')}"
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILENAME="groupthink-${TIMESTAMP}.sql.gz"
EXIT_CODE=0
ERROR_MSG=""

# ── Logging ──
log() { echo "[pg-backup] $(date -Iseconds) $*"; }
err() { echo "[pg-backup] ERROR $(date -Iseconds) $*" >&2; }

# ── Phase 1: Dump ──
log "starting pg_dump of ${PG_DATABASE}@${PG_HOST}:${PG_PORT}..."

DUMP_OUTPUT=$(pg_dump \
  -h "$PG_HOST" \
  -p "$PG_PORT" \
  -U "$PG_USER" \
  -d "$PG_DATABASE" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --no-comments \
  --verbose \
  2>&1) || {
  EXIT_CODE=$?
  ERROR_MSG="pg_dump failed (exit $EXIT_CODE): $(echo "$DUMP_OUTPUT" | tail -3)"
  err "$ERROR_MSG"
}

log "pg_dump completed successfully (${#DUMP_OUTPUT} bytes dump output)"

# ── Phase 2: Store ──
if [ "$BACKEND" = "s3" ]; then
  # ── S3 backend ──
  if [ -z "${S3_BUCKET:-}" ]; then
    err "S3_BACKEND requires S3_BUCKET env var"
    exit 2
  fi

  S3_KEY="groupthink/${BACKUP_FILENAME}"
  log "uploading to s3://${S3_BUCKET}/${S3_KEY}..."

  # Dump directly to S3 to avoid intermediate file
  pg_dump \
    -h "$PG_HOST" \
    -p "$PG_PORT" \
    -U "$PG_USER" \
    -d "$PG_DATABASE" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --no-comments \
    2>/dev/null | \
  aws s3 cp - "s3://${S3_BUCKET}/${S3_KEY}" --expected-size 100000000 || {
    EXIT_CODE=$?
    ERROR_MSG="S3 upload failed (exit $EXIT_CODE)"
    err "$ERROR_MSG"
  }

  log "backup uploaded to s3://${S3_BUCKET}/${S3_KEY}"

  # Clean old S3 backups
  if [ "$RETENTION_DAYS" -gt 0 ]; then
    CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d)
    log "purging S3 backups older than ${RETENTION_DAYS} days (before ${CUTOFF})..."
    aws s3 ls "s3://${S3_BUCKET}/groupthink/" | while read -r line; do
      DATE_PART=$(echo "$line" | awk '{print $4}' | grep -oP '\d{8}')
      if [ -n "$DATE_PART" ] && [ "$DATE_PART" -lt "$CUTOFF" ] 2>/dev/null; then
        KEY=$(echo "$line" | awk '{print $4}')
        aws s3 rm "s3://${S3_BUCKET}/${KEY}"
        log "  purged ${KEY}"
      fi
    done
  fi
else
  # ── Volume backend (default) ──
  mkdir -p "$BACKUP_DIR"

  log "writing to ${BACKUP_DIR}/${BACKUP_FILENAME}..."
  pg_dump \
    -h "$PG_HOST" \
    -p "$PG_PORT" \
    -U "$PG_USER" \
    -d "$PG_DATABASE" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --no-comments \
    2>/dev/null > "${BACKUP_DIR}/${BACKUP_FILENAME}" || {
    EXIT_CODE=$?
    ERROR_MSG="local write failed (exit $EXIT_CODE)"
    err "$ERROR_MSG"
    rm -f "${BACKUP_DIR}/${BACKUP_FILENAME}"
  }

  log "backup written to ${BACKUP_DIR}/${BACKUP_FILENAME} ($(du -h "${BACKUP_DIR}/${BACKUP_FILENAME}" | cut -f1))"

  # Clean old backups
  if [ "$RETENTION_DAYS" -gt 0 ]; then
    log "purging local backups older than ${RETENTION_DAYS} days..."
    find "$BACKUP_DIR" -name "groupthink-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
  fi
fi

# ── Notification on failure ──
if [ "$EXIT_CODE" -ne 0 ] && [ -n "${BACKUP_NOTIFY_URL:-}" ]; then
  PAYLOAD=$(cat <<EOF
{
  "title": "Groupthink backup FAILED",
  "message": "Database: ${PG_DATABASE}, Host: ${PG_HOST}:${PG_PORT}, Error: ${ERROR_MSG}",
  "priority": 5
}
EOF
)
  curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$BACKUP_NOTIFY_URL" 2>/dev/null || true
fi

log "backup finished (exit=$EXIT_CODE)"
exit "$EXIT_CODE"
