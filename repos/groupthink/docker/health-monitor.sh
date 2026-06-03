#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# health-monitor.sh — Container health monitoring & alerting for Groupthink
# ═══════════════════════════════════════════════════════════════════════════
#
# Periodically probes the /health/ready endpoint and alerts when the
# container is degraded or unreachable. Tracks consecutive failures and
# issues a notification when a configurable threshold is exceeded.
#
# Designed to run as a cron job (every 5 minutes) or as a sidecar
# alongside the main container in the agent-stack.
#
# Environment variables:
#   HEALTH_URL       — Health endpoint URL (default: http://localhost:3000/health/ready)
#   HEALTH_INTERVAL  — Seconds between checks (default: 60 — ignored when run via cron)
#   FAILURE_THRESHOLD— Consecutive failures before alerting (default: 3)
#   ALERT_URL        — Webhook URL for alert notifications (default: none)
#   ALERT_SILENCE_FILE— Path to silence flag (default: /tmp/groupthink-alert-silenced)
#   STATUS_FILE      — Path to failure count state (default: /tmp/groupthink-health-status)
#   LOG_FILE         — Path to log output (default: stdout/stderr)
#
# Exit codes:
#   0 — healthy (no failures)
#   1 — degraded (failures below threshold)
#   2 — critical (failures at or above threshold)
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ──
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health/ready}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
STATUS_FILE="${STATUS_FILE:-/tmp/groupthink-health-status}"
ALERT_SILENCE_FILE="${ALERT_SILENCE_FILE:-/tmp/groupthink-alert-silenced}"
ALERT_URL="${ALERT_URL:-}"

# ── Logging ──
log() { echo "[health-monitor] $(date -Iseconds) $*"; }
err() { echo "[health-monitor] ERROR $(date -Iseconds) $*" >&2; }

# ── Load current failure count ──
CURRENT_FAILURES=0
if [ -f "$STATUS_FILE" ]; then
  CURRENT_FAILURES=$(cat "$STATUS_FILE" 2>/dev/null || echo 0)
fi

# ── Probe health endpoint ──
log "probing ${HEALTH_URL}..."

HTTP_STATUS=""
RESPONSE_BODY=""

# Use a 5-second timeout for the health check
if response=$(curl -s -o /tmp/groupthink-health-response.txt -w "%{http_code}" \
  --max-time 5 "${HEALTH_URL}" 2>/dev/null); then
  HTTP_STATUS="$response"
  RESPONSE_BODY=$(cat /tmp/groupthink-health-response.txt 2>/dev/null || true)
else
  HTTP_STATUS="000"
  RESPONSE_BODY="curl failed"
fi

rm -f /tmp/groupthink-health-response.txt

# ── Evaluate health ──
if [ "$HTTP_STATUS" = "200" ]; then
  # Healthy — reset failure counter
  if [ "$CURRENT_FAILURES" -gt 0 ]; then
    log "health restored (was ${CURRENT_FAILURES} failures)"
    CURRENT_FAILURES=0
    echo 0 > "$STATUS_FILE"
  fi
  log "healthy (HTTP ${HTTP_STATUS})"
  exit 0
else
  # Failure — increment counter
  CURRENT_FAILURES=$((CURRENT_FAILURES + 1))
  echo "$CURRENT_FAILURES" > "$STATUS_FILE"

  log "unhealthy: HTTP ${HTTP_STATUS} (failure ${CURRENT_FAILURES}/${FAILURE_THRESHOLD})"
  log "response: ${RESPONSE_BODY}"

  if [ "$CURRENT_FAILURES" -ge "$FAILURE_THRESHOLD" ] && [ ! -f "$ALERT_SILENCE_FILE" ]; then
    # ── Critical — send alert ──
    TIMESTAMP=$(date -Iseconds)
    SUMMARY="Groupthink health check FAILED (${CURRENT_FAILURES} consecutive failures)"
    DETAIL="URL: ${HEALTH_URL}
HTTP Status: ${HTTP_STATUS}
Response: ${RESPONSE_BODY}
Timestamp: ${TIMESTAMP}"

    err "${SUMMARY}"
    echo "${DETAIL}"

    # Webhook notification
    if [ -n "$ALERT_URL" ]; then
      PAYLOAD=$(cat <<EOF
{
  "title": "Groupthink health CRITICAL",
  "message": "${SUMMARY} — HTTP ${HTTP_STATUS}, ${RESPONSE_BODY}",
  "priority": 5,
  "timestamp": "${TIMESTAMP}"
}
EOF
)
      curl -s -X POST -H "Content-Type: application/json" \
        -d "$PAYLOAD" "$ALERT_URL" 2>/dev/null || true
      log "alert sent to ${ALERT_URL}"
    fi

    # Log to syslog so the host monitoring pipeline picks it up
    logger -t groupthink-health "CRITICAL: ${SUMMARY}" || true

    exit 2
  fi

  exit 1
fi
