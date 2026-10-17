import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { createEngineRegistry, ENGINES } from "@classicade/games";
import { getGame, IDENTITY_KINDS } from "@classicade/shared";
import { createAccountAccessor } from "./data/accountAccessor.js";
import { createAnalyticsAccessor } from "./data/analyticsAccessor.js";
import { createGamificationAccessor } from "./data/gamificationAccessor.js";
import { createLeaderboardAccessor } from "./data/leaderboardAccessor.js";
import { createLegacyUserAccessor } from "./data/legacyUserAccessor.js";
import { createMatchAccessor } from "./data/matchAccessor.js";
import { createPlayerTransferAccessor } from "./data/playerTransferAccessor.js";
import { createProgressAccessor } from "./data/progressAccessor.js";
import { createRoomAccessor } from "./data/roomAccessor.js";
import { createAccountComponent } from "./domain/accounts/accountComponent.js";
import { createAnalyticsComponent, REPORT_TTL_MS } from "./domain/analytics/analyticsComponent.js";
import { createGamificationComponent } from "./domain/gamification/gamificationComponent.js";
import { createIdentityComponent } from "./domain/identity/identityComponent.js";
import { createPlayerTransferComponent } from "./domain/identity/playerTransferComponent.js";
import { createLeaderboardComponent } from "./domain/leaderboards/leaderboardComponent.js";
import { createMatchComponent } from "./domain/matches/matchComponent.js";
import {
  createProgressionComponent,
  PROGRESSION_EVENTS,
  XP_SOURCES,
} from "./domain/progression/progressionComponent.js";
import { createRoomComponent, ROOM_EVENTS } from "./domain/rooms/roomComponent.js";
import { roomLifetimes } from "./domain/rooms/roomLifetimes.js";
import { roomLimits } from "./domain/rooms/roomLimits.js";
import { createAccountDao } from "./persistence/accountDao.js";
import { createAchievementDao } from "./persistence/achievementDao.js";
import { createAnalyticsDao } from "./persistence/analyticsDao.js";
import { connectDatabase } from "./persistence/database.js";
import { createLeaderboardDao } from "./persistence/leaderboardDao.js";
import { createLegacyUserDao } from "./persistence/legacyUserDao.js";
import { createMatchDao } from "./persistence/matchDao.js";
import { createPlayerTransferDao } from "./persistence/playerTransferDao.js";
import { createProgressDao } from "./persistence/progressDao.js";
import { createQuestDao } from "./persistence/questDao.js";
import { createRoomDao } from "./persistence/roomDao.js";
import { createSessionStore } from "./persistence/sessionStore.js";
import { createStatsDao } from "./persistence/statsDao.js";
import { createHttpApp } from "./service/http/app.js";
import { createSessionCheck, createSessionMiddleware, SESSION_TTL_SECONDS } from "./service/http/session.js";
import { createRealtimeGateway } from "./service/realtime/gateway.js";
import { createBackgroundTasks } from "./utils/backgroundTasks.js";
import { createNetworkKey } from "./utils/networkKey.js";
import { createPasswordHasher } from "./utils/passwordHasher.js";
import { createTtlCache } from "./utils/ttlCache.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const SESSION_ENDED = "sessionEnded";
const OTHER_SESSIONS_ENDED = "otherSessionsEnded";
const ROOM_SWEEP_INTERVAL_MS = 60_000;
const GAUGE_INTERVAL_MS = 60_000;
const CLOCK_TICK_INTERVAL_MS = 1_000;
const TRANSFER_RESUME_INTERVAL_MS = 60_000;
// Owner console reports kept at once: one per range the owner looked at in the last 5 minutes.
const ANALYTICS_CACHED_REPORTS = 20;

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
 * After a game ends: record the match, award progression from the recorded match (so XP only ever comes from a
 * persisted match), then count it for achievements, streaks and quests (CC-054, CC-089), then move its accounts up
 * the leaderboards (CC-053). Each step runs as a background task — a slow database never delays a game — and
 * shutdown drains them. Before progression, a match recorded for a guest who has just signed in moves to their
 * account (CC-032), so the account gets the XP, the streak, the quest progress and the board entries. Then the
 * match is judged once for fair play (CC-095): every later step gives nothing to a player it doesn't count for. The
 * leaderboard step runs even when the gamification step failed.
 *
 * @param {{
 *   domainEvents: import("node:events").EventEmitter,
 *   matchComponent: { recordFinished: Function, judge: Function },
 *   playerTransferComponent: { follow: Function },
 *   progressionComponent: { applyMatch: Function },
 *   gamificationComponent: { applyMatch: Function },
 *   leaderboardComponent: { applyMatch: Function },
 *   tasks: ReturnType<typeof createBackgroundTasks>,
 *   logger: Logger,
 *   now?: () => number,
 * }} deps
 */
export function connectMatchPipeline({
  domainEvents,
  matchComponent,
  playerTransferComponent,
  progressionComponent,
  gamificationComponent,
  leaderboardComponent,
  tasks,
  logger,
  now = Date.now,
}) {
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
            // Judged after following, so the fair play limits look at the players as they are now (CC-095).
            const followed = await matchComponent.judge(
              await playerTransferComponent.follow({ match, now: now() }),
            );
            const updates = await progressionComponent.applyMatch(followed);
            logger.info(
              {
                matchId: match.matchId,
                players: updates.length,
                notCounted: followed.credit.notCounted.map(({ reason }) => reason),
              },
              "progression applied",
            );
            tasks.run(
              "apply gamification",
              async () => {
                try {
                  await gamificationComponent.applyMatch({ match: followed, updates, now: now() });
                  logger.info({ matchId: match.matchId }, "gamification applied");
                } finally {
                  tasks.run(
                    "apply leaderboards",
                    async () => {
                      await leaderboardComponent.applyMatch({ match: followed, updates });
                      logger.info({ matchId: match.matchId }, "leaderboards applied");
                    },
                    { matchId: match.matchId },
                  );
                }
              },
              { matchId: match.matchId },
            );
          },
          { matchId: match.matchId },
        );
      },
      { roomCode: event.room.code },
    );
  });
}

/**
 * Bonus XP outside matches (daily quests, CC-089) also counts for the XP leaderboards (CC-053). Progression
 * announces every award; match awards already reach the boards through the match pipeline.
 *
 * @param {{
 *   domainEvents: import("node:events").EventEmitter,
 *   leaderboardComponent: { applyBonus: Function },
 *   tasks: ReturnType<typeof createBackgroundTasks>,
 *   now?: () => number,
 * }} deps
 */
export function connectLeaderboardBonuses({ domainEvents, leaderboardComponent, tasks, now = Date.now }) {
  domainEvents.on(PROGRESSION_EVENTS.UPDATED, (update) => {
    if (update.source !== XP_SOURCES.QUEST) {
      return;
    }
    tasks.run(
      "apply bonus to leaderboards",
      () => leaderboardComponent.applyBonus({ ...update, at: now() }),
      {
        key: update.key,
      },
    );
  });
}

/**
 * Periodic work: close idle rooms, apply game deadlines that have passed (a chess flag falling while nobody
 * moves), and finish guest → account transfers that were interrupted (CC-032). A failing run is logged and the
 * next one still happens. Timers don't keep the process alive.
 *
 * Once a minute it also logs a gauge: how many rooms are open in each status and how many realtime connections and
 * players there are (CC-107). Operators read it to see how close the server is to its limits (roomLimits.js).
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof createRoomComponent>, "sweepExpired" | "expireDue" | "countRooms">,
 *   playerTransferComponent: Pick<ReturnType<typeof createPlayerTransferComponent>, "resumePending">,
 *   connections: () => { connections: number, players: number },
 *   logger: Logger,
 *   now?: () => number,
 *   sweepIntervalMs?: number,
 * }} deps  `sweepIntervalMs` is shorter only in tests that watch a room close
 * @returns {{ stop: () => void }}
 */
export function startHousekeeping({
  roomComponent,
  playerTransferComponent,
  connections,
  logger,
  now = Date.now,
  sweepIntervalMs = ROOM_SWEEP_INTERVAL_MS,
}) {
  const every = (intervalMs, work, failure) => {
    const timer = setInterval(() => {
      // Work may be synchronous or return a promise; both kinds of failure are logged the same way.
      new Promise((resolve) => resolve(work())).catch((err) => logger.error({ err }, failure));
    }, intervalMs);
    timer.unref();
    return timer;
  };
  const timers = [
    every(sweepIntervalMs, () => roomComponent.sweepExpired({ now: now() }), "room sweep failed"),
    every(
      CLOCK_TICK_INTERVAL_MS,
      () => roomComponent.expireDue({ now: now() }),
      "applying game deadlines failed",
    ),
    every(
      TRANSFER_RESUME_INTERVAL_MS,
      async () => {
        const { completed, failed } = await playerTransferComponent.resumePending({ now: now() });
        completed.forEach((from) => logger.info({ playerId: from }, "guest transfer resumed and completed"));
        failed.forEach(({ from, error }) =>
          logger.error({ err: error, playerId: from }, "guest transfer failed again"),
        );
      },
      "resuming guest transfers failed",
    ),
    every(
      GAUGE_INTERVAL_MS,
      async () => {
        const rooms = await roomComponent.countRooms();
        const open = Object.values(rooms).reduce((sum, count) => sum + count, 0);
        logger.info({ rooms: { ...rooms, open }, ...connections() }, "room gauge");
      },
      "reading the room gauge failed",
    ),
  ];
  return { stop: () => timers.forEach((timer) => clearInterval(timer)) };
}

/**
 * Seats and player data follow who the player is, and everyone in the rooms concerned sees the change:
 * - a guest who signs in keeps their seats — rooms hand them to the account (CC-083) — and their XP and match
 *   history move to the account (CC-032); the answer says what moved;
 * - someone who signs out gives up their seats in rooms that haven't started (CC-085).
 *
 * @param {{
 *   roomComponent: ReturnType<typeof createRoomComponent>,
 *   playerTransferComponent: Pick<ReturnType<typeof createPlayerTransferComponent>, "transfer">,
 *   domainEvents: import("node:events").EventEmitter,
 *   now?: () => number,
 * }} deps
 * @returns {Parameters<typeof createHttpApp>[0]["onIdentityChanged"]}
 */
export function identityFollowers({ roomComponent, playerTransferComponent, domainEvents, now = Date.now }) {
  const announce = (rooms) => rooms.forEach((room) => domainEvents.emit(ROOM_EVENTS.UPDATED, { room }));
  return async ({ previous, identity }) => {
    if (previous === undefined) {
      return {};
    }
    if (identity === undefined) {
      announce(await roomComponent.giveUpWaitingSeats({ playerId: previous.id, now: now() }));
      return {};
    }
    if (previous.kind !== IDENTITY_KINDS.GUEST || previous.id === identity.id) {
      return {};
    }
    announce(await roomComponent.transferPlayer({ from: previous.id, to: identity, now: now() }));
    return playerTransferComponent.transfer({ from: previous.id, to: identity, now: now() });
  };
}

/**
 * Composition root: builds every layer bottom-up, wires dependencies, and starts listening.
 * The only module allowed to know about all layers.
 *
 * @param {{
 *   config: Readonly<import("./config/index.js").Config>,
 *   logger: Logger,
 *   limits?: { auth?: object, guest?: { windowMs: number, limit: number }, leaderboard?: { windowMs: number, limit: number }, api?: { windowMs: number, limit: number } },
 *     rate limits; production uses the
 *     defaults — only browser tests raise them, because every test player shares one IP
 *   now?: () => number,
 *   rooms?: {
 *     lifetimes?: Partial<import("./domain/rooms/roomLifetimes.js").RoomLifetimes>,
 *     limits?: Partial<import("./domain/rooms/roomLimits.js").RoomLimits>,
 *     sweepIntervalMs?: number,
 *   },
 * }} deps  `now` and `rooms` are for tests only. Production runs on the real clock and the standard room
 *   lifetimes and limits. Integration tests move the clock, and browser tests shorten lifetimes to watch a room
 *   close, raise the connections per address (every test player shares one) and fill the server on purpose.
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export async function startServer({ config, logger, limits = {}, now = Date.now, rooms = {} }) {
  if (config.webDistDir !== "" && !existsSync(path.join(config.webDistDir, "index.html"))) {
    throw new Error(`WEB_DIST_DIR has no index.html: ${config.webDistDir} (run npm run build:web)`);
  }

  // 4. persistence
  const database = await connectDatabase({ uri: config.mongoUri, logger });
  const sessionStore = await createSessionStore({ client: database.client, ttlSeconds: SESSION_TTL_SECONDS });

  const roomDao = createRoomDao({ connection: database.connection });
  const matchDao = createMatchDao({ connection: database.connection });
  const progressDao = createProgressDao({ connection: database.connection });
  const accountDao = createAccountDao({ connection: database.connection });
  const statsDao = createStatsDao({ connection: database.connection });
  const questDao = createQuestDao({ connection: database.connection });
  const achievementDao = createAchievementDao({ connection: database.connection });
  const legacyUserDao = createLegacyUserDao({ connection: database.connection }); // read-only, CC-078
  const playerTransferDao = createPlayerTransferDao({ connection: database.connection });
  const leaderboardDao = createLeaderboardDao({ connection: database.connection });
  const analyticsDao = createAnalyticsDao({ connection: database.connection }); // read-only, CC-233
  await Promise.all(
    [
      roomDao,
      matchDao,
      progressDao,
      accountDao,
      playerTransferDao,
      statsDao,
      questDao,
      achievementDao,
      leaderboardDao,
    ].map((dao) => dao.ensureIndexes()),
  );

  // 3. data
  const roomAccessor = createRoomAccessor({ roomDao });
  const matchAccessor = createMatchAccessor({ matchDao });
  const progressAccessor = createProgressAccessor({ progressDao });
  const accountAccessor = createAccountAccessor({ accountDao });
  const legacyUserAccessor = createLegacyUserAccessor({ legacyUserDao });
  const playerTransferAccessor = createPlayerTransferAccessor({ playerTransferDao });
  const gamificationAccessor = createGamificationAccessor({ statsDao, questDao, achievementDao });
  const leaderboardAccessor = createLeaderboardAccessor({ leaderboardDao });
  const analyticsAccessor = createAnalyticsAccessor({ analyticsDao });

  // 2. domain
  assertEnginesInCatalog(ENGINES);
  const domainEvents = new EventEmitter();
  const identityComponent = createIdentityComponent();
  const accountComponent = createAccountComponent({
    accountAccessor,
    legacyUserAccessor,
    passwordHasher: createPasswordHasher(),
  });
  const limitsOfRooms = roomLimits(rooms.limits);
  const roomComponent = createRoomComponent({
    roomAccessor,
    engines: createEngineRegistry(ENGINES),
    events: domainEvents,
    lifetimes: roomLifetimes(rooms.lifetimes),
    limits: limitsOfRooms,
  });
  const matchComponent = createMatchComponent({ matchAccessor });
  const progressionComponent = createProgressionComponent({
    progressAccessor,
    matchAccessor,
    events: domainEvents,
  });
  const gamificationComponent = createGamificationComponent({
    gamificationAccessor,
    matchAccessor,
    progressionComponent,
    events: domainEvents,
  });
  const leaderboardComponent = createLeaderboardComponent({
    leaderboardAccessor,
    matchAccessor,
    progressAccessor,
  });
  // Everything stored by player id moves with a guest who signs in (ADR-014), in this order. Leaderboards go
  // last: they are recomputed from the progress and matches that have moved by then.
  const playerTransferComponent = createPlayerTransferComponent({
    playerTransferAccessor,
    participants: [
      { name: "matches", transferPlayer: matchComponent.transferPlayer },
      { name: "progress", transferPlayer: progressionComponent.transferPlayer },
      { name: "gamification", transferPlayer: gamificationComponent.transferPlayer },
      { name: "leaderboards", transferPlayer: leaderboardComponent.transferPlayer },
    ],
    matches: matchComponent,
  });
  const analyticsComponent = createAnalyticsComponent({
    analyticsAccessor,
    cache: createTtlCache({ ttlMs: REPORT_TTL_MS, maxEntries: ANALYTICS_CACHED_REPORTS }),
  });
  const tasks = createBackgroundTasks({ logger });
  connectMatchPipeline({
    domainEvents,
    matchComponent,
    playerTransferComponent,
    progressionComponent,
    gamificationComponent,
    leaderboardComponent,
    tasks,
    logger,
    now,
  });
  connectLeaderboardBonuses({ domainEvents, leaderboardComponent, tasks, now });

  // Rooms are stored, so they outlive this process (CC-101). Nobody is connected to a process that has only
  // just started, and a chess flag may have fallen while no server was running: settle both before anyone
  // can join. A game that ends here is recorded through the match pipeline above.
  try {
    await roomComponent.markEveryoneAway({ now: now() });
    await roomComponent.expireDue({ now: now() });
  } catch (err) {
    await database.close();
    throw err;
  }

  // 1. service — HTTP and realtime share one session middleware, so both see the same identity
  const sessionMiddleware = createSessionMiddleware({
    store: sessionStore,
    secret: config.sessionSecret,
    secureCookies: config.isProduction,
  });
  const sessionEvents = new EventEmitter();
  // HTTP and realtime ask the same question of every signed-in session (CC-116).
  const checkSession = createSessionCheck({ accountComponent, now });
  const app = createHttpApp({
    config,
    logger,
    isDatabaseUp: database.isConnected,
    authLimits: limits.auth,
    guestLimit: limits.guest,
    leaderboardLimit: limits.leaderboard,
    apiLimit: limits.api,
    leaderboardComponent,
    analyticsComponent,
    sessionMiddleware,
    identityComponent,
    matchComponent,
    progressionComponent,
    gamificationComponent,
    accountComponent,
    now,
    onSessionEnded: (sessionId) => sessionEvents.emit(SESSION_ENDED, sessionId),
    onOtherSessionsEnded: (which) => sessionEvents.emit(OTHER_SESSIONS_ENDED, which),
    checkSession,
    onIdentityChanged: identityFollowers({ roomComponent, playerTransferComponent, domainEvents, now }),
  });
  const server = http.createServer(app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware,
    allowedOrigins: config.allowedOrigins,
    logger,
    roomComponent,
    domainEvents,
    checkSession,
    trustProxyHops: config.trustProxyHops,
    networkOf: createNetworkKey({ secret: config.sessionSecret }),
    limits: limitsOfRooms,
    now,
  });
  sessionEvents.on(SESSION_ENDED, (sessionId) => gateway.disconnectSession(sessionId));
  sessionEvents.on(OTHER_SESSIONS_ENDED, (which) => gateway.disconnectOtherSessions(which));

  const housekeeping = startHousekeeping({
    roomComponent,
    playerTransferComponent,
    connections: gateway.counts,
    logger,
    now,
    sweepIntervalMs: rooms.sweepIntervalMs,
  });

  const close = async () => {
    housekeeping.stop();
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
