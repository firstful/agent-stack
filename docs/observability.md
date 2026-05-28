# Observability (OpenTelemetry)

An `observability` service provides distributed tracing via OpenTelemetry:

```
app → OTLP HTTP → otel-collector → OTLP gRPC → Tempo → Grafana UI
```

## Components

- **otel-collector** (sidecar) — Receives OTLP traces via HTTP at port 4318, batches them, and forwards to Tempo
- **Tempo** (sidecar) — Trace storage backend, receives OTLP gRPC from collector, retains traces for 48h
- **Grafana** (main container) — Web UI at `https://observability.ffilt.us`, pre-configured with Tempo datasource (Explore → Tempo → search)

All three run on the `stack-net` network. Services send traces to `http://observability--otel-collector:4318/v1/traces`.

## Env Vars Injected Into Every Service

Every container service automatically receives:

| Variable | Value |
|----------|-------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://observability--otel-collector:4318` |
| `OTEL_SERVICE_NAME` | `<service-name>` |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=production` |

These are standard OpenTelemetry env vars. Any service with an OTel SDK will auto-discover the collector.

## Adding Instrumentation to a Service

**Node.js services:** Install the OTel SDK packages and import a tracing initializer before all other imports:

```bash
npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/sdk-node @opentelemetry/semantic-conventions
```

```ts
// server/tracing.ts — imported first in your entry point
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { NodeSDK } from '@opentelemetry/sdk-node'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
if (endpoint) {
  const sdk = new NodeSDK({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations()],
  })
  sdk.start()
}
```
