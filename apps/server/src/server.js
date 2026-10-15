import { EventEmitter } from "node:events";
import http from "node:http";
import { createIdentityComponent } from "./domain/identity/identityComponent.js";
import { connectDatabase } from "./persistence/database.js";
import { createSessionStore } from "./persistence/sessionStore.js";
import { createHttpApp } from "./service/http/app.js";
import { createSessionMiddleware, SESSION_TTL_SECONDS } from "./service/http/session.js";
import { createRealtimeGateway } from "./service/realtime/gateway.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_ENDED = "sessionEnded";

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
export async function startServer({ config, logger }) {
  // 4. persistence
  const database = await connectDatabase({ uri: config.mongoUri, logger });
  const sessionStore = await createSessionStore({ client: database.client, ttlSeconds: SESSION_TTL_SECONDS });

  // 2. domain
  const identityComponent = createIdentityComponent();

  // 1. service — HTTP and realtime share one session middleware, so both see the same identity
  const sessionMiddleware = createSessionMiddleware({
    store: sessionStore,
    secret: config.sessionSecret,
    secureCookies: config.isProduction,
  });
  const sessionEvents = new EventEmitter();
  const app = createHttpApp({
    config,
    logger,
    sessionMiddleware,
    identityComponent,
    onSessionEnded: (sessionId) => sessionEvents.emit(SESSION_ENDED, sessionId),
  });
  const server = http.createServer(app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware,
    allowedOrigins: config.allowedOrigins,
    logger,
  });
  sessionEvents.on(SESSION_ENDED, (sessionId) => gateway.disconnectSession(sessionId));

  const close = async () => {
    await gateway.close();
    await database.close();
  };

  try {
    const port = await listen(server, config.port);
    return { server, port, close };
  } catch (err) {
    await database.close();
    throw err;
  }
}

/**
 * @param {http.Server} server
 * @param {number} port
 * @returns {Promise<number>} the bound port (useful when `port` is 0)
 */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(/** @type {import("node:net").AddressInfo} */ (server.address()).port);
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
