# Agent Stack

A lightweight container orchestration system using Podman, Cloudflare Tunnel, and a Node.js controller that reconciles desired state.

## Quick Links

- [Architecture & Operations](docs/architecture.md) — System overview, directory structure, service configuration, key operations, and adding services
- [Change Detection](docs/change-detection.md) — How the controller detects when to rebuild containers (git-aware and file-based hashing)
- [Service Discovery](docs/service-discovery.md) — Auto-injected environment variables for inter-service communication
- [Observability](docs/observability.md) — OpenTelemetry tracing setup and instrumentation
- [Cloudflare Access](docs/cloudflare-access.md) — Service token headers for programmatic access to `*.ffilt.us` endpoints
- [Infrastructure Endpoints](config/wiki/agent-stack-endpoints.md) — REST API, HTTP interfaces, and service proxying
