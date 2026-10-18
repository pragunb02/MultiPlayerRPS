import { EventEmitter } from "node:events";
import http from "node:http";
import session from "express-session";
import { BOTS, createBotRegistry, createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createAccountAccessor } from "../data/accountAccessor.js";
import { createAnalyticsAccessor } from "../data/analyticsAccessor.js";
import { createGamificationAccessor } from "../data/gamificationAccessor.js";
import { createLeaderboardAccessor } from "../data/leaderboardAccessor.js";
import { createLegacyUserAccessor } from "../data/legacyUserAccessor.js";
import { createMatchAccessor } from "../data/matchAccessor.js";
import { createPlayerTransferAccessor } from "../data/playerTransferAccessor.js";
import { createProgressAccessor } from "../data/progressAccessor.js";
import { createRoomAccessor } from "../data/roomAccessor.js";
import { createAccountComponent } from "../domain/accounts/accountComponent.js";
import { createAnalyticsComponent } from "../domain/analytics/analyticsComponent.js";
import { createBotComponent } from "../domain/bots/botComponent.js";
import { createBotDriver } from "../domain/bots/botDriver.js";
import { createBotTurns } from "../domain/bots/botTurns.js";
import { createSealMaker, sealSecretFrom } from "../domain/bots/seals.js";
import { createThinkingQueue } from "../domain/bots/thinkingQueue.js";
import { createGamificationComponent } from "../domain/gamification/gamificationComponent.js";
import { createIdentityComponent } from "../domain/identity/identityComponent.js";
import { createPlayerTransferComponent } from "../domain/identity/playerTransferComponent.js";
import { createLeaderboardComponent } from "../domain/leaderboards/leaderboardComponent.js";
import { createMatchComponent } from "../domain/matches/matchComponent.js";
import { createProgressionComponent } from "../domain/progression/progressionComponent.js";
import { createRoomComponent, ROOM_EVENTS } from "../domain/rooms/roomComponent.js";
import { createInMemoryRoomDao } from "./inMemoryRoomDao.js";
import { connectLeaderboardBonuses, connectMatchPipeline, identityFollowers } from "../server.js";
import { createHttpApp } from "../service/http/app.js";
import { createSessionCheck, createSessionMiddleware } from "../service/http/session.js";
import { createRealtimeGateway } from "../service/realtime/gateway.js";
import { createBackgroundTasks } from "../utils/backgroundTasks.js";
import { createNetworkKey } from "../utils/networkKey.js";
import { createPasswordHasher } from "../utils/passwordHasher.js";
import { createTtlCache } from "../utils/ttlCache.js";
import { createEmptyAnalyticsDao } from "./emptyAnalyticsDao.js";
import { captureLogger } from "./captureLogger.js";
import { createInMemoryAccountDao } from "./inMemoryAccountDao.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "./inMemoryGamificationDaos.js";
import { createInMemoryLeaderboardDao } from "./inMemoryLeaderboardDao.js";
import { createInMemoryLegacyUserDao } from "./inMemoryLegacyUserDao.js";
import { createInMemoryMatchDao } from "./inMemoryMatchDao.js";
import { createInMemoryPlayerTransferDao } from "./inMemoryPlayerTransferDao.js";
import { createInMemoryProgressDao } from "./inMemoryProgressDao.js";
import { testConfig } from "./testConfig.js";

/**
 * Wires the app the same way the composition root does, but with in-memory stores (sessions, rooms,
 * matches), deterministic guests and seed 42 — fast tests without a database.
 *
 * @param {{
 *   env?: Record<string, string>,
 *   guestLimit?: { windowMs: number, limit: number },
 *   engines?: ReadonlyArray<any>,
 *   authLimits?: object,
 *   legacyUsers?: ReadonlyArray<object>,
 *   isDatabaseUp?: () => boolean,
 *   transferParticipants?: (participants: ReadonlyArray<object>) => ReadonlyArray<object>,  lets a test change who
 *     takes part in moving a guest's data (e.g. one that fails)
 *   leaderboardLimit?: { windowMs: number, limit: number },
 *   apiLimit?: { windowMs: number, limit: number },
 *   roomLimits?: Readonly<import("../domain/rooms/roomLimits.js").RoomLimits>,
 *   accountDao?: ReturnType<typeof createInMemoryAccountDao>,   lets a test make account storage fail
 *   now?: () => number,
 *   analyticsDao?: object,   the owner console's totals (CC-233), an empty site unless a test gives its own
 * }} [options]
 */
export function createTestApp({
  env = {},
  guestLimit,
  authLimits,
  engines = [raceEngine],
  legacyUsers = [],
  isDatabaseUp = () => true,
  transferParticipants = (participants) => participants,
  leaderboardLimit,
  apiLimit,
  roomLimits,
  accountDao = createInMemoryAccountDao(),
  now = Date.now,
  analyticsDao = createEmptyAnalyticsDao(),
} = {}) {
  const config = testConfig(env);
  const capture = captureLogger();
  const store = new session.MemoryStore();
  const sessionMiddleware = createSessionMiddleware({
    store,
    secret: config.sessionSecret,
    secureCookies: config.isProduction,
  });
  let guestNumber = 0;
  const identityComponent = createIdentityComponent({
    generateId: () => `00000000-0000-4000-8000-${String(++guestNumber).padStart(12, "0")}`,
    generateGuestSuffix: () => `T${String(guestNumber).padStart(3, "0")}`,
  });
  const accountComponent = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao }),
    legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(legacyUsers) }),
    passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }), // fast for tests
  });
  const domainEvents = new EventEmitter();
  const engineRegistry = createEngineRegistry(engines);
  const roomAccessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  const botTurns = createBotTurns({
    bots: createBotRegistry(BOTS.filter((bot) => engineRegistry.has(bot.gameId))),
    engines: engineRegistry,
    sealMaker: createSealMaker({ secret: sealSecretFrom(config.sessionSecret) }),
  });
  const roomComponent = createRoomComponent({
    roomAccessor,
    engines: engineRegistry,
    events: domainEvents,
    generateSeed: () => 42,
    ...(roomLimits && { limits: roomLimits }),
    botTurns,
  });
  const botComponent = createBotComponent({ roomComponent, roomAccessor, events: domainEvents });
  // Computer players act at once in tests, so a test only waits for the server, never for a pause.
  const botDriver = createBotDriver({
    roomComponent,
    roomAccessor,
    botTurns,
    botComponent,
    thinking: createThinkingQueue(),
    events: domainEvents,
    delayMs: () => 0,
    logger: capture.logger,
    retryMs: 10,
    now,
  });
  domainEvents.on(ROOM_EVENTS.CHANGED, ({ room }) => botDriver.watch(room));
  const matchAccessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
  const progressAccessor = createProgressAccessor({ progressDao: createInMemoryProgressDao() });
  const matchComponent = createMatchComponent({ matchAccessor });
  const progressionComponent = createProgressionComponent({
    progressAccessor,
    matchAccessor,
    events: domainEvents,
  });
  const leaderboardComponent = createLeaderboardComponent({
    leaderboardAccessor: createLeaderboardAccessor({ leaderboardDao: createInMemoryLeaderboardDao() }),
    matchAccessor,
    progressAccessor,
  });
  const gamificationComponent = createGamificationComponent({
    gamificationAccessor: createGamificationAccessor({
      statsDao: createInMemoryStatsDao(),
      questDao: createInMemoryQuestDao(),
      achievementDao: createInMemoryAchievementDao(),
    }),
    matchAccessor,
    progressionComponent,
    events: domainEvents,
  });
  const playerTransferComponent = createPlayerTransferComponent({
    playerTransferAccessor: createPlayerTransferAccessor({
      playerTransferDao: createInMemoryPlayerTransferDao(),
    }),
    participants: transferParticipants([
      { name: "matches", transferPlayer: matchComponent.transferPlayer },
      { name: "progress", transferPlayer: progressionComponent.transferPlayer },
      { name: "gamification", transferPlayer: gamificationComponent.transferPlayer },
      { name: "leaderboards", transferPlayer: leaderboardComponent.transferPlayer },
    ]),
    matches: matchComponent,
  });
  const tasks = createBackgroundTasks({ logger: capture.logger });
  connectMatchPipeline({
    domainEvents,
    matchComponent,
    playerTransferComponent,
    progressionComponent,
    gamificationComponent,
    leaderboardComponent,
    tasks,
    logger: capture.logger,
    now,
  });
  connectLeaderboardBonuses({ domainEvents, leaderboardComponent, tasks, now });
  const endedSessions = [];
  const endedListeners = [];
  const otherSessionsEnded = [];
  const otherEndedListeners = [];
  const checkSession = createSessionCheck({ accountComponent, now });

  const app = createHttpApp({
    config,
    logger: capture.logger,
    isDatabaseUp,
    sessionMiddleware,
    identityComponent,
    matchComponent,
    progressionComponent,
    gamificationComponent,
    accountComponent,
    authLimits,
    guestLimit,
    now,
    leaderboardComponent,
    leaderboardLimit,
    apiLimit,
    analyticsComponent: createAnalyticsComponent({
      analyticsAccessor: createAnalyticsAccessor({ analyticsDao }),
      cache: createTtlCache({ ttlMs: 1, maxEntries: 1 }),
    }),
    onIdentityChanged: identityFollowers({ roomComponent, playerTransferComponent, domainEvents, now }),
    onSessionEnded: (sessionId) => {
      endedSessions.push(sessionId);
      endedListeners.forEach((listener) => listener(sessionId));
    },
    onOtherSessionsEnded: (which) => {
      otherSessionsEnded.push(which);
      otherEndedListeners.forEach((listener) => listener(which));
    },
    checkSession,
  });

  return {
    app,
    config,
    store,
    accountDao,
    sessionMiddleware,
    domainEvents,
    roomComponent,
    botComponent,
    botDriver,
    matchComponent,
    progressionComponent,
    playerTransferComponent,
    gamificationComponent,
    leaderboardComponent,
    tasks,
    endedSessions,
    otherSessionsEnded,
    checkSession,
    onSessionEnded: (listener) => endedListeners.push(listener),
    onOtherSessionsEnded: (listener) => otherEndedListeners.push(listener),
    ...capture,
  };
}

/**
 * A clock that runs in real time from noon UTC on `day` — daily quests depend on the date, so tests pick one.
 *
 * @param {string} day  "YYYY-MM-DD"
 * @returns {() => number}
 */
export function clockOn(day) {
  const start = Date.now();
  const noon = Date.parse(`${day}T12:00:00.000Z`);
  return () => noon + (Date.now() - start);
}

/**
 * Starts the HTTP app plus the realtime gateway on a random local port, with rooms running the
 * reference "race" engine by default (seed 42: the second seat moves first).
 *
 * @param {Parameters<typeof createTestApp>[0] & { now?: () => number }} [options]  `roomLimits` also sets the
 *   realtime limits (connections and events), and `env.TRUST_PROXY_HOPS` how sockets find the player's address
 */
export async function startTestServer({ now = Date.now, ...options } = {}) {
  const testApp = createTestApp({ ...options, now });
  const server = http.createServer(testApp.app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware: testApp.sessionMiddleware,
    allowedOrigins: testApp.config.allowedOrigins,
    logger: testApp.logger,
    roomComponent: testApp.roomComponent,
    domainEvents: testApp.domainEvents,
    checkSession: testApp.checkSession,
    trustProxyHops: testApp.config.trustProxyHops,
    networkOf: createNetworkKey({ now }),
    now,
    ...(options.roomLimits && { limits: options.roomLimits }),
    botComponent: testApp.botComponent,
  });
  testApp.onSessionEnded((sessionId) => gateway.disconnectSession(sessionId));
  testApp.onOtherSessionsEnded((which) => gateway.disconnectOtherSessions(which));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    ...testApp,
    gateway,
    httpServer: server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      testApp.botDriver.stop();
      await gateway.close();
      await testApp.tasks.drain();
    },
  };
}
