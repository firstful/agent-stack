# Semantic Context Virtualization Middleware (SCVM)

This directory contains the decomposed specification for the SCVM system.

---

## Specification Index

| Document | Description |
|----------|-------------|
| [Overview](spec/overview.md) | System overview, functional goals, and non-goals |
| [Architecture](spec/architecture.md) | High-level architecture diagram and primary concepts (transcript spans, summary nodes, memory handles, working set) |
| [API](spec/api.md) | API compatibility (OpenAI-compatible endpoints) and internal canonical types |
| [Compression](spec/compression.md) | Compression lifecycle, triggers, and flow |
| [Tools](spec/tools.md) | Required and additional hidden middleware tools |
| [Tool Interception](spec/tool-interception.md) | Tool interception flow, recursive expansion, and hidden orchestration rules |
| [Context Engine](spec/context-engine.md) | Context assembly engine, token budgeting, and streaming architecture |
| [Provider](spec/provider.md) | Provider layer normalization, capability model, and memory ranking |
| [Persistence](spec/persistence.md) | Durability requirements and storage model recommendations |
| [Failure & Security](spec/failure-security.md) | Failure handling strategies and security requirements |
| [Observability](spec/observability.md) | Metrics, token & cost visibility, and OpenTelemetry integration |
| [Stack](spec/stack.md) | Recommended initial technology stack |
| [Roadmap](spec/roadmap.md) | MVP scope (Phase 1-3) and Phase 4 Profile System |
| [Principles](spec/principles.md) | Critical architectural principles and insights |

---

## Quick Navigation

- **Getting started**: [Overview](spec/overview.md) → [Architecture](spec/architecture.md) → [Roadmap](spec/roadmap.md)
- **Building the core**: [API](spec/api.md) → [Context Engine](spec/context-engine.md) → [Compression](spec/compression.md)
- **Tooling**: [Tools](spec/tools.md) → [Tool Interception](spec/tool-interception.md)
- **Operations**: [Persistence](spec/persistence.md) → [Failure & Security](spec/failure-security.md) → [Observability](spec/observability.md)
