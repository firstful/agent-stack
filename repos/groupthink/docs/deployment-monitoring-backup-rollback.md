# Groupthink — Deployment, Monitoring, Backup & Rollback

## Overview

This document describes the deployment infrastructure, monitoring setup,
backup strategy, and rollback procedures for the Groupthink service.

## Architecture

Groupthink runs as a Podman container managed by the agent-stack controller
at `/srv/agent-stack`. It uses a slot-swap (blue-green) deployment model.

```
┌────────────────────────────────────────────────────────────────────┐
│  Agent-Stack Controller (reconciles every 5s)                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  groupthink--a  ← active slot  (port 4001)                   │ │
│  │  groupthink--b  ← idle slot   (port 4002)                    │ │
│  │  groupthink--db ← Postgres 16 sidecar  (port 5432)           │ │
│  │  groupthink--redis ← Redis 7 sidecar  (port 6379)           │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  Observability:                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  observability--otel-collector ← OTLP traces + metrics       │ │
│  │  observability--quickwit      ← structured log storage       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## 1. Log Aggregation

### Structured JSON Logging

All application logs are written as newline-delimited JSON to stdout/stderr
by `apps/api/src/logger.ts`. Each log entry includes:

| Field     | Description                         |
|-----------|-------------------------------------|
| timestamp | ISO-8601 timestamp                  |
| level     | debug / info / warn / error         |
| service   | "groupthink"                        |
| message   | Log message text                    |
| meta      | Structured metadata (JSON object)   |
| stack     | Error stack trace (error level)     |

### HTTP Request Logging

The `requestLoggingMiddleware` (from `apps/api/src/request-logger.ts`) wraps
every HTTP request and logs a structured JSON entry on completion. Log levels
vary by status code:

- **error** — 5xx responses (server errors)
- **warn** — 4xx responses (client errors)
- **info** — 2xx/3xx responses (success)

Each request log captures: method, path, status, duration (ms), user agent,
client IP, and x-user-id (if present).

### OpenTelemetry Traces & Metrics

The `initTelemetry()` call (from `apps/api/src/telemetry.ts`) initialises
the OpenTelemetry Node.js SDK with auto-instrumentation for:

- **Traces**: Exported via OTLP HTTP to `observability--otel-collector:4318`
- **Metrics**: Exported every 30s to the same OTLP endpoint
- **Service name**: Set via `OTEL_SERVICE_NAME` (default: "groupthink")

Instrumented libraries include: HTTP, gRPC, PostgreSQL, Redis, and other
commonly patched modules.

### Pipeline

```
Application stdout/stderr (JSON lines)
       │
       ▼
OpenTelemetry Collector (observability--otel-collector)
       │
       ├──→ Quickwit (structured log storage & search)
       │
       └──→ Tempo (trace storage) / Grafana (visualisation)
```

## 2. Health Checks & Monitoring

### Endpoints

| Path            | Purpose        | Used By                    |
|-----------------|----------------|----------------------------|
| `/health/live`  | Liveness probe | Agent-stack health check   |
| `/health/ready` | Readiness probe| Load balancer / slot-swap  |
| `/health`       | Legacy check   | Ingress compatibility      |

The `/health/ready` endpoint validates:
1. **PostgreSQL** — executes `SELECT 1`, reports latency
2. **Redis** — sends `PING`, expects `PONG`, reports latency

Returns 200 if all healthy, 503 if any dependency is degraded.

### Health Monitor (`docker/health-monitor.sh`)

A standalone monitoring script that probes `/health/ready` periodically and
alerts on repeated failures:

- Tracks consecutive failures in `/tmp/groupthink-health-status`
- Configurable threshold (`FAILURE_THRESHOLD`, default: 3)
- Sends webhook alert via `ALERT_URL` environment variable
- Logs to syslog via `logger` for host-level monitoring
- Respects silence file at `/tmp/groupthink-alert-silenced`

**Scheduled via cron every 5 minutes** (see cron job below).

### Agent-Stack Controller Monitoring

The controller reconciles every 5 seconds and surfaces service state at:

- `GET /api/status` — overall controller health + service states
- `GET /api/services/groupthink` — Groupthink-specific status
- `GET /api/logs/groupthink` — container logs via API

The slot-swap health check (30s timeout) catches deployment failures
before traffic is switched to a bad slot.

## 3. Backup Strategy

### Database Backup (`docker/pg-backup.sh`)

PostgreSQL backups are handled by `docker/pg-backup.sh`, which uses `pg_dump`
in custom format (compressed, parallel-restore capable).

**Backends:**

| Backend  | Storage Location       | Retention                     |
|----------|------------------------|-------------------------------|
| `volume` | `BACKUP_DIR` (default: `/backups`) | `RETENTION_DAYS` (default: 30) |
| `s3`     | `s3://BUCKET/groupthink/` | Client-side cleanup by date prefix |

**Backup format:** Custom-format (`--format=custom`) with maximum compression
(`--compress=9`), excluding owner/privileges comments for portability.

**Schedule:** Daily at 03:00 via cron (see cron jobs below).

**Failure notification:** When `BACKUP_NOTIFY_URL` is set, sends a JSON
webhook payload on backup failure.

### Configuration

Environment variables for the backup cron job:

| Variable           | Default                        | Description                    |
|--------------------|--------------------------------|--------------------------------|
| `DATABASE_URL`     | —                              | Postgres connection string     |
| `BACKEND`          | `volume`                       | Storage backend                |
| `BACKUP_DIR`       | `/backups`                     | Local backup directory         |
| `S3_BUCKET`        | —                              | S3 bucket (S3 backend only)    |
| `RETENTION_DAYS`   | `30`                           | Backup retention period        |
| `BACKUP_NOTIFY_URL`| —                              | Failure webhook URL            |

### Recovery

```bash
# Restore latest backup (volume backend)
pg_restore -h groupthink--db -U groupthink -d groupthink --clean \
  $(ls -t /backups/groupthink-*.sql.gz | head -1)

# Or via the rollback script with --db flag
./docker/rollback.sh --db
```

## 4. Rollback Strategy

### Slot-Swap Rollback (Automatic)

The agent-stack controller's slot-swap deployment provides automatic rollback:

1. **New build fails health check** → Idle slot is removed, old slot continues
2. **Build succeeds but container doesn't start** → Old slot stays active
3. **Both containers dead** → Controller rebuilds from scratch

This is all handled by `infra/lib/reconcile.ts` — no manual intervention
needed for build failures.

### Manual Rollback Script (`docker/rollback.sh`)

For situations where a bad deploy succeeded but needs reverting:

**Scenario 1: Swap happened (slot-b is active, slot-a is still running)**
```bash
./docker/rollback.sh
```
→ Stops the new slot, promotes the old slot back to active.

**Scenario 2: Only one version deployed, needs revert to previous commit**
```bash
./docker/rollback.sh
```
→ Checks out `HEAD~1`, triggers controller rebuild.

**Scenario 3: Full rollback including database**
```bash
./docker/rollback.sh --db
```
→ Container rollback + restore latest database backup.

**Scenario 4: Rollback with specific backup file**
```bash
./docker/rollback.sh --db --backup=/backups/groupthink-20260529-030000.sql.gz
```

### Database Rollback Considerations

- pg_restore with `--clean` drops and recreates tables — data added after
  the backup was taken will be lost.
- Application must be stopped during restore to prevent concurrent writes.
- Migrations are run by the entrypoint on startup — if rolling back to a
  schema version that doesn't match the database, manually run `drizzle-kit push`
  from within the container.

### Preventive Measures

- All deploys go through the slot-swap with health check (30s timeout)
- Config changes trigger automatic rebuild via hash change detection
- Failed builds have exponential backoff to avoid thrashing
- Monitor alerts fire after 3 consecutive unhealthy health checks (~15 min)
- Daily database backups with 30-day retention
