/**
 * Structured JSON logger for Groupthink.
 *
 * Outputs each log entry as a single JSON line to stdout/stderr,
 * enriched with service name, level, timestamp, and optional metadata.
 * The OTEL collector (via filelog receiver) or log-aggregation pipeline
 * picks these up automatically.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  /** Optional structured metadata — must be JSON-serialisable */
  meta?: Record<string, unknown>;
  /** Error stack trace, set automatically for error-level */
  stack?: string;
}

const SERVICE_NAME = "groupthink";

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    message,
  };
  if (meta) entry.meta = meta;

  const line = formatEntry(entry);

  if (level === "error") {
    // Capture stack trace for errors
    const err = new Error();
    const stack = err.stack?.split("\n").slice(2).join("\n") || "";
    entry.stack = stack;
    process.stderr.write(formatEntry(entry) + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ── Public API ──

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),

  /**
   * Create a child logger with additional fixed metadata.
   * Useful for per-request or per-component logging.
   */
  child: (fixedMeta: Record<string, unknown>) => {
    const childLogger = { ...logger };
    for (const level of ["debug", "info", "warn", "error"] as LogLevel[]) {
      const orig = childLogger[level];
      childLogger[level] = (message: string, meta?: Record<string, unknown>) => {
        orig(message, { ...fixedMeta, ...meta });
      };
    }
    return childLogger;
  },
};
