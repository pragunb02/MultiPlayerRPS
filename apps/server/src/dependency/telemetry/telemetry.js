import { NO_OPERATIONS_METRICS } from "../../utils/operationsMetrics.js";

/**
 * @typedef {Object} Telemetry
 * @property {Readonly<import("../../utils/operationsMetrics.js").OperationsMetrics>} metrics
 * @property {{ write: (line: string) => void } | undefined} forward  the logger's second stream, or undefined
 *   when logs are not sent
 * @property {() => Promise<void>} flush     exports what is waiting now (tests and shutdown)
 * @property {() => Promise<void>} shutdown  flushes once and stops. Running it again does nothing
 */

const nothingAsync = async () => undefined;

/** Telemetry switched off: every method does nothing, and no OpenTelemetry module is loaded. */
export const NO_TELEMETRY = Object.freeze({
  metrics: NO_OPERATIONS_METRICS,
  forward: undefined,
  flush: nothingAsync,
  shutdown: nothingAsync,
});

/**
 * Starts operations telemetry (ADR-055), or answers NO_TELEMETRY when it is off. The OpenTelemetry SDK is loaded
 * only when it is on, so a server without OTEL_EXPORTER_OTLP_ENDPOINT runs no SDK code, no timer and no event-loop
 * monitor, and opens no connection. Only the composition root calls this. Everything else receives `metrics` or
 * one of its methods.
 *
 * @param {{
 *   settings: Readonly<import("../../config/telemetry.js").TelemetrySettings>,
 *   matchSteps: ReadonlyArray<string>,
 *   onExportFailed: (failure: { signal: "metrics" | "logs", error: unknown }) => void,  told at most once a minute
 *   exporters?: { metrics: import("@opentelemetry/sdk-metrics").PushMetricExporter, logs: import("@opentelemetry/sdk-logs").LogRecordExporter },
 *   loadSdk?: () => Promise<typeof import("./openTelemetry.js")>,
 *   now?: () => number,
 * }} deps  `exporters`, `loadSdk` and `now` are for tests: production sends OTLP over HTTP to the endpoint
 * @returns {Promise<Readonly<Telemetry>>}
 */
export async function startTelemetry({
  settings,
  matchSteps,
  onExportFailed,
  exporters,
  loadSdk = () => import("./openTelemetry.js"),
  now = Date.now,
}) {
  if (!settings.enabled) {
    return NO_TELEMETRY;
  }
  const { startOpenTelemetry } = await loadSdk();
  return startOpenTelemetry({ settings, matchSteps, onExportFailed, exporters, now });
}
