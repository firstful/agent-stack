import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from "@opentelemetry/semantic-conventions"
import { NodeSDK } from "@opentelemetry/sdk-node"

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

export function initTracing(): void {
  if (!endpoint) {
    console.log("[tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set; skipping OpenTelemetry")
    return
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "engramic",
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
        process.env.OTEL_RESOURCE_ATTRIBUTES?.match(/deployment\.environment=(\w+)/)?.[1] || "production",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/+$/, "")}/v1/traces`,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  })

  sdk.start()

  process.on("SIGTERM", () => sdk.shutdown())
  process.on("SIGINT", () => sdk.shutdown())

  console.log(`[tracing] OpenTelemetry initialized, exporting to ${endpoint}`)
}
