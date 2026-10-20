import { existsSync } from "node:fs";
import { loadConfig } from "./config/index.js";
import { startTelemetry } from "./dependency/telemetry/telemetry.js";
import { createLogger } from "./utils/logger.js";
import { handleFatalErrors, handleShutdownSignals, MATCH_STEPS, startServer } from "./server.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // No validated log level yet: report the config problem with a default logger, then stop.
  createLogger({ level: "info" }).fatal({ err }, "invalid configuration");
  process.exit(1);
}

// Off, and without loading any OpenTelemetry code, unless OTEL_EXPORTER_OTLP_ENDPOINT is set (ADR-055). A failed
// export is told to the logger made just below, which exists by the time the first export runs. That warning is
// not a named line, so it is never sent itself.
const telemetry = await startTelemetry({
  settings: config.telemetry,
  matchSteps: Object.values(MATCH_STEPS),
  onExportFailed: ({ signal, error }) => logger.warn({ signal, err: error }, "telemetry export failed"),
});
const logger = createLogger({ level: config.logLevel, forward: telemetry.forward });
handleFatalErrors({ logger });
if (config.telemetry.enabled) {
  logger.info({ logs: config.telemetry.logs, intervalMs: config.telemetry.exportIntervalMs }, "telemetry on");
}

const server = await startServer({ config, logger, metrics: telemetry.metrics });
const close = async () => {
  await server.close();
  await telemetry.shutdown();
};
handleShutdownSignals({ close, logger });
