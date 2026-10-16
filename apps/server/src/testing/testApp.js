import { EventEmitter } from "node:events";
import http from "node:http";
import session from "express-session";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createAccountAccessor } from "../data/accountAccessor.js";
import { createGamificationAccessor } from "../data/gamificationAccessor.js";
import { createLegacyUserAccessor } from "../data/legacyUserAccessor.js";
import { createMatchAccessor } from "../data/matchAccessor.js";
import { createPlayerTransferAccessor } from "../data/playerTransferAccessor.js";
import { createProgressAccessor } from "../data/progressAccessor.js";
import { createRoomAccessor } from "../data/roomAccessor.js";
import { createAccountComponent } from "../domain/accounts/accountComponent.js";
import { createGamificationComponent } from "../domain/gamification/gamificationComponent.js";
import { createIdentityComponent } from "../domain/identity/identityComponent.js";
import { createPlayerTransferComponent } from "../domain/identity/playerTransferComponent.js";
import { createMatchComponent } from "../domain/matches/matchComponent.js";
import { createProgressionComponent } from "../domain/progression/progressionComponent.js";
import { createRoomComponent } from "../domain/rooms/roomComponent.js";
import { createInMemoryRoomDao } from "../persistence/inMemoryRoomDao.js";
import { connectMatchPipeline, identityFollowers } from "../server.js";
import { createHttpApp } from "../service/http/app.js";
import { createSessionMiddleware } from "../service/http/session.js";
import { createRealtimeGateway } from "../service/realtime/gateway.js";
import { createBackgroundTasks } from "../utils/backgroundTasks.js";
import { createPasswordHasher } from "../utils/passwordHasher.js";
import { captureLogger } from "./captureLogger.js";
import { createInMemoryAccountDao } from "./inMemoryAccountDao.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "./inMemoryGamificationDaos.js";
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
 *   now?: () => number,
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
  now = Date.now,
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
  const accountDao = createInMemoryAccountDao();
  const accountComponent = createAccountComponent({
    accountAccessor: createAccountAccessor({ accountDao }),
    legacyUserAccessor: createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(legacyUsers) }),
    passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }), // fast for tests
  });
  const domainEvents = new EventEmitter();
  const roomComponent = createRoomComponent({
    roomAccessor: createRoomAccessor({ roomDao: createInMemoryRoomDao() }),
    engines: createEngineRegistry(engines),
    events: domainEvents,
    generateSeed: () => 42,
  });
  const matchAccessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
  const matchComponent = createMatchComponent({ matchAccessor });
  const progressionComponent = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao: createInMemoryProgressDao() }),
    events: domainEvents,
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
    tasks,
    logger: capture.logger,
    now,
  });
  const endedSessions = [];
  const endedListeners = [];

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
    onIdentityChanged: identityFollowers({ roomComponent, playerTransferComponent, domainEvents, now }),
    onSessionEnded: (sessionId) => {
      endedSessions.push(sessionId);
      endedListeners.forEach((listener) => listener(sessionId));
    },
  });

  return {
    app,
    config,
    store,
    accountDao,
    sessionMiddleware,
    domainEvents,
    roomComponent,
    matchComponent,
    progressionComponent,
    playerTransferComponent,
    gamificationComponent,
    tasks,
    endedSessions,
    onSessionEnded: (listener) => endedListeners.push(listener),
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
 * @param {Parameters<typeof createTestApp>[0] & {
 *   rateLimit?: { capacity: number, refillPerSecond: number },
 *   now?: () => number,
 * }} [options]
 */
export async function startTestServer({ rateLimit, now = Date.now, ...options } = {}) {
  const testApp = createTestApp({ ...options, now });
  const server = http.createServer(testApp.app);
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware: testApp.sessionMiddleware,
    allowedOrigins: testApp.config.allowedOrigins,
    logger: testApp.logger,
    roomComponent: testApp.roomComponent,
    domainEvents: testApp.domainEvents,
    now,
    ...(rateLimit && { rateLimit }),
  });
  testApp.onSessionEnded((sessionId) => gateway.disconnectSession(sessionId));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    ...testApp,
    gateway,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await gateway.close();
      await testApp.tasks.drain();
    },
  };
}
