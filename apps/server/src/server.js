import http from "node:http";
import { createApp } from "./app.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Starts the HTTP server and resolves once it is listening.
 *
 * @param {{ config: Readonly<import("./config/index.js").Config> }} deps
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export function startServer({ config }) {
  const server = http.createServer(createApp({ config }));

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
 * @param {() => Promise<void>} close
 */
export function handleShutdownSignals(close) {
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    close().then(
      () => process.exit(0),
      (err) => {
        console.error("Error during shutdown", err);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
