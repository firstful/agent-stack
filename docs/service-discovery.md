# Service Discovery

## Overview

Container services on the `stack-net` network can discover each other via environment variables injected at container start.

## Discovery Environment Variables

When a container starts, `reconcile.ts` via `podman.ts:buildDiscoveryEnv()` injects environment variables of the form:

```
CONTAINERS_<NAME>_HOST=<hostname>
CONTAINERS_<NAME>_PRIMARY_PORT=<port>
```

Where `<NAME>` is the service name uppercased with non-alphanumeric characters replaced by underscores.

## Container-to-Container Discovery

Services with a `container.port` setting are reachable by their service name via DNS on `stack-net`.

## Host Service Discovery

Systemd-managed services (no `container` block) are reachable at `host.containers.internal:<port>`.

## All Resolved Hosts

Every container gets these `/etc/hosts` entries:
- `host.containers.internal` → host gateway
- `runtime` → host gateway
- `agent-stack` → host gateway
