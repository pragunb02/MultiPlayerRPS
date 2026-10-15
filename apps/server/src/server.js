import http from "node:http";
import { createHttpApp } from "./service/http/app.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * @typedef {import("./utils/logger.js").Logger} Logger
 * @typedef {Pick<NodeJS.Process, "on" | "once" | "exit">} ProcessLike
 */

/**
 * Composition root: builds every layer bottom-up, wires dependencies, and starts listening.
 * The only module allowed to know about all layers.
 *
 * @param {{ config: Readonly<import("./config/index.js").Config>, logger: Logger }} deps
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export function startServer({ config, logger }) {
  const server = http.createServer(createHttpApp({ config, logger }));

  const close = () =>
    new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeIdleConnections();
    });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      const address = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({ server, port: address.port, close });
    });
  });
}

/**
 * Closes the server on SIGINT/SIGTERM, forcing exit if open connections don't drain in time.
 *
 * @param {{ close: () => Promise<void>, logger: Logger, proc?: ProcessLike, timeoutMs?: number }} options
 *   `proc` and `timeoutMs` are injectable so the behaviour can be unit tested without real signals.
 */
export function handleShutdownSignals({ close, logger, proc = process, timeoutMs = SHUTDOWN_TIMEOUT_MS }) {
  const shutdown = (signal) => {
    logger.info({ signal }, "shutting down");
    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, "shutdown timed out, forcing exit");
      proc.exit(1);
    }, timeoutMs);
    forceExit.unref();
    close().then(
      () => {
        clearTimeout(forceExit);
        logger.info("shutdown complete");
        proc.exit(0);
      },
      (err) => {
        clearTimeout(forceExit);
        logger.error({ err }, "error during shutdown");
        proc.exit(1);
      },
    );
  };
  proc.once("SIGINT", shutdown);
  proc.once("SIGTERM", shutdown);
}

/**
 * A crash we did not anticipate leaves the process in an unknown state: log it as fatal and exit,
 * so the platform restarts a clean instance.
 *
 * @param {{ logger: Logger, proc?: ProcessLike }} options
 */
export function handleFatalErrors({ logger, proc = process }) {
  proc.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    proc.exit(1);
  });
  proc.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    proc.exit(1);
  });
}
