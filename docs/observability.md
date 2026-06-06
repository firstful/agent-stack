# Observability

## Overview

The agent-stack infrastructure includes OpenTelemetry-based observability for monitoring container performance, request traces, and system health.

## Components

- **Grafana**: Dashboard UI at `config/observability/`
- **Tempo**: Distributed tracing backend
- **OTEL Collector**: OpenTelemetry collector for trace/metric ingestion

## Configuration

- Grafana datasources: `config/observability/`
- Tempo configuration: `config/observability/`
- OTEL configuration: `config/observability/`

## Performance Snapshots

The controller collects performance snapshots every 5 minutes via `infra/lib/perf.ts`:
- System CPU, memory, disk I/O
- Per-container stats (CPU, memory, network, block I/O)
- Top CPU and memory processes

Snapshots are persisted to `runtime/perf-history.json` (max 288 entries = 24 hours at 5-minute intervals).

## Access

- API: `GET /api/perf` (performance history)
- API: `POST /api/perf/collect` (trigger immediate collection)
