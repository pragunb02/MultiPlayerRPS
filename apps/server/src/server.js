import { EventEmitter } from "node:events";
import http from "node:http";
import { createEngineRegistry, ENGINES } from "@classicade/games";
import { getGame } from "@classicade/shared";
import { createAccountAccessor } from "./data/accountAccessor.js";
import { createMatchAccessor } from "./data/matchAccessor.js";
import { createProgressAccessor } from "./data/progressAccessor.js";
import { createRoomAccessor } from "./data/roomAccessor.js";
import { createAccountComponent } from "./domain/accounts/accountComponent.js";
import { createIdentityComponent } from "./domain/identity/identityComponent.js";
import { createMatchComponent } from "./domain/matches/matchComponent.js";
import { createProgressionComponent } from "./domain/progression/progressionComponent.js";
import { createRoomComponent, ROOM_EVENTS } from "./domain/rooms/roomComponent.js";
import { createAccountDao } from "./persistence/accountDao.js";
import { connectDatabase } from "./persistence/database.js";
import { createInMemoryRoomDao } from "./persistence/inMemoryRoomDao.js";
import { createMatchDao } from "./persistence/matchDao.js";
import { createProgressDao } from "./persistence/progressDao.js";
import { createSessionStore } from "./persistence/sessionStore.js";
import { createHttpApp } from "./service/http/app.js";
import { createSessionMiddleware, SESSION_TTL_SECONDS } from "./service/http/session.js";
import { createRealtimeGateway } from "./service/realtime/gateway.js";
import { createBackgroundTasks } from "./utils/backgroundTasks.js";
import { createPasswordHasher } from "./utils/passwordHasher.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_ENDED = "sessionEnded";
const ROOM_SWEEP_INTERVAL_MS = 60_000;
const CLOCK_TICK_INTERVAL_MS = 1_000;

/**
 * Every playable engine must be listed in the public game catalog (and vice versa once all games exist).
 * Checked at boot so a half-registered game never ships.
 *
 * @param {ReadonlyArray<{ id: string }>} engines
 */
export function assertEnginesInCatalog(engines) {
  const missing = engines.filter((engine) => getGame(engine.id) === undefined).map((engine) => engine.id);
  if (missing.length > 0) {
    throw new Error(`Engines missing from the game catalog: ${missing.join(", ")}`);
  }
}

/**
 * @typedef {import("./utils/logger.js").Logger} Logger
 * @typedef {Pick<NodeJS.Process, "on" | "once" | "exit">} ProcessLike
 */

/**
 * After a game ends: record the match, then award progression from the recorded match (so XP only ever comes
 * from a persisted match). Both steps run as background tasks — a slow database never delays a game — and
 * shutdown drains them.
 *
 * @param {{
 *   domainEvents: import("node:events").EventEmitter,
 *   matchComponent: { recordFinished: Function },
 *   progressionComponent: { applyMatch: Function },
 *   tasks: ReturnType<typeof createBackgroundTasks>,
 *   logger: Logger,
 * }} deps
 */
export function connectMatchPipeline({ domainEvents, matchComponent, progressionComponent, tasks, logger }) {
  domainEvents.on(ROOM_EVENTS.GAME_FINISHED, (event) => {
    tasks.run(
      "record match",
      async () => {
        const match = await matchComponent.recordFinished(event);
        logger.info(
          { matchId: match.matchId, gameId: match.gameId, reason: match.result.reason },
          "match recorded",
        );
        tasks.run(
          "apply progression",
          async () => {
            const updates = await progressionComponent.applyMatch(match);
            logger.info({ matchId: match.matchId, players: updates.length }, "progression applied");
          },
          { matchId: match.matchId },
        );
      },
      { roomCode: event.room.code },
    );
  });
}

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

  const roomDao = createInMemoryRoomDao();
  const matchDao = createMatchDao({ connection: database.connection });
  const progressDao = createProgressDao({ connection: database.connection });
  const accountDao = createAccountDao({ connection: database.connection });
  await Promise.all([matchDao.ensureIndexes(), progressDao.ensureIndexes(), accountDao.ensureIndexes()]);

  // 3. data
  const roomAccessor = createRoomAccessor({ roomDao });
  const matchAccessor = createMatchAccessor({ matchDao });
  const progressAccessor = createProgressAccessor({ progressDao });
  const accountAccessor = createAccountAccessor({ accountDao });

  // 2. domain
  assertEnginesInCatalog(ENGINES);
  const domainEvents = new EventEmitter();
  const identityComponent = createIdentityComponent();
  const accountComponent = createAccountComponent({
    accountAccessor,
    passwordHasher: createPasswordHasher(),
  });
  const roomComponent = createRoomComponent({
    roomAccessor,
    engines: createEngineRegistry(ENGINES),
    events: domainEvents,
  });
  const matchComponent = createMatchComponent({ matchAccessor });
  const progressionComponent = createProgressionComponent({ progressAccessor, events: domainEvents });
  const tasks = createBackgroundTasks({ logger });
  connectMatchPipeline({ domainEvents, matchComponent, progressionComponent, tasks, logger });

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
    matchComponent,
    progressionComponent,
    accountComponent,
    onSessionEnded: (sessionId) => sessionEvents.emit(SESSION_ENDED, sessionId),
  });
  const server = http.createServer(app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware,
    allowedOrigins: config.allowedOrigins,
    logger,
    roomComponent,
    domainEvents,
  });
  sessionEvents.on(SESSION_ENDED, (sessionId) => gateway.disconnectSession(sessionId));

  const sweeper = setInterval(() => {
    try {
      roomComponent.sweepExpired({ now: Date.now() });
    } catch (err) {
      logger.error({ err }, "room sweep failed");
    }
  }, ROOM_SWEEP_INTERVAL_MS);
  sweeper.unref();

  // Game clocks: apply any engine deadline that has passed (a flag falling while nobody moves).
  const clockTicker = setInterval(() => {
    try {
      roomComponent.expireDue({ now: Date.now() });
    } catch (err) {
      logger.error({ err }, "applying game deadlines failed");
    }
  }, CLOCK_TICK_INTERVAL_MS);
  clockTicker.unref();

  const close = async () => {
    clearInterval(sweeper);
    clearInterval(clockTicker);
    await gateway.close();
    await tasks.drain();
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
