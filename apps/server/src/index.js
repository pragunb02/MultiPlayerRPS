import { existsSync } from "node:fs";
import { loadConfig } from "./config/index.js";
import { createLogger } from "./utils/logger.js";
import { handleFatalErrors, handleShutdownSignals, startServer } from "./server.js";

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

const logger = createLogger({ level: config.logLevel });
handleFatalErrors({ logger });

const { close } = await startServer({ config, logger });
handleShutdownSignals({ close, logger });
