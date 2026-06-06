# Agent Stack Architecture

## Overview

This document describes the high-level architecture of the agent-stack container orchestration system.

## Key Components

- **Controller** (`infra/controller.ts`): HTTP server and reconciliation loop entry point
- **Reconcile Worker** (`infra/reconcile-worker.ts`): Background worker that ensures desired state
- **Library modules** (`infra/lib/`): Shared utilities for podman, services, routing, and telemetry

## Service Lifecycle

Services are defined in `repos/<name>/agent-stack.json` (container services) or `desired/<name>.json` (systemd services). The reconcile worker periodically checks desired vs. actual state and creates/updates/removes containers accordingly.

## Slot Swap (Zero-Downtime Deployment)

Each container service gets two slots (`--a` and `--b`). On a new build, the idle slot receives the new image, health checks pass, then traffic swaps. See [slot-swap-plan.md](../config/wiki/slot-swap-plan.md) for details.
