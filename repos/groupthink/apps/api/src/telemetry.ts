/**
 * OpenTelemetry initialisation for Groupthink.
 *
 * Registers the Node.js SDK with OTLP export so that traces and metrics
 * flow to the observability pipeline (otel-collector → Quickwit / Tempo).
 *
 * This module must be imported BEFORE any other module (including 'hono'
 * and 'postgres') so that auto-instrumentation can monkey-patch them.
 *
 * The env var OTEL_EXPORTER_OTLP_ENDPOINT is set in agent-stack.json.
 * If it's missing, telemetry is silently disabled (no crash).
 */

const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "groupthink";
const OTEL_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://observability--otel-collector:4318";

let telemetryEnabled = false;

/**
 * Initialise OpenTelemetry if the @opentelemetry packages are available
 * (they may be added to package.json later without code changes).
 * Returns true if telemetry was started, false if unavailable.
 */
export function initTelemetry(): boolean {
  if (telemetryEnabled) return true;

  try {
    // Dynamic require so missing deps don't crash the app
    const { NodeSDK } = require("@opentelemetry/sdk-node") as typeof import("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = require(
      "@opentelemetry/auto-instrumentations-node"
    ) as typeof import("@opentelemetry/auto-instrumentations-node");
    const { OTLPTraceExporter } = require(
      "@opentelemetry/exporter-trace-otlp-http"
    ) as typeof import("@opentelemetry/exporter-trace-otlp-http");
    const { OTLPMetricExporter } = require(
      "@opentelemetry/exporter-metrics-otlp-http"
    ) as typeof import("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = require(
      "@opentelemetry/sdk-metrics"
    ) as typeof import("@opentelemetry/sdk-metrics");

    const traceExporter = new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`,
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${OTEL_ENDPOINT}/v1/metrics`,
    });

    const sdk = new NodeSDK({
      serviceName: OTEL_SERVICE_NAME,
      traceExporter,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30_000,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
    telemetryEnabled = true;

    // Graceful shutdown
    process.on("SIGTERM", () => {
      sdk
        .shutdown()
        .catch((err: unknown) =>
          console.error("[telemetry] shutdown error:", err)
        );
    });

    console.log(
      `[telemetry] OTEL SDK started — exporting to ${OTEL_ENDPOINT}`
    );
    return true;
  } catch {
    console.log(
      "[telemetry] @opentelemetry packages not installed — telemetry disabled"
    );
    return false;
  }
}

export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}
