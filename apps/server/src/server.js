import http from "node:http";
import { createHttpApp } from "./service/http/app.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Composition root: builds every layer bottom-up, wires dependencies, and starts listening.
 * The only module allowed to know about all layers.
 *
 * @param {{ config: Readonly<import("./config/index.js").Config> }} deps
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export function startServer({ config }) {
  const server = http.createServer(createHttpApp({ config }));

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
 * `proc` and `logger` are injectable so the behaviour can be unit tested without real signals.
 *
 * @param {{
 *   close: () => Promise<void>,
 *   proc?: Pick<NodeJS.Process, "once" | "exit">,
 *   logger?: Pick<Console, "log" | "error">,
 *   timeoutMs?: number,
 * }} options
 */
export function handleShutdownSignals({
  close,
  proc = process,
  logger = console,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
}) {
  const shutdown = (signal) => {
    logger.log(`${signal} received, shutting down`);
    const forceExit = setTimeout(() => proc.exit(1), timeoutMs);
    forceExit.unref();
    close().then(
      () => {
        clearTimeout(forceExit);
        proc.exit(0);
      },
      (err) => {
        clearTimeout(forceExit);
        logger.error("Error during shutdown", err);
        proc.exit(1);
      },
    );
  };
  proc.once("SIGINT", shutdown);
  proc.once("SIGTERM", shutdown);
}
