import { EventEmitter } from "node:events";
import http from "node:http";
import session from "express-session";
import { createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createAccountAccessor } from "../data/accountAccessor.js";
import { createLegacyUserAccessor } from "../data/legacyUserAccessor.js";
import { createMatchAccessor } from "../data/matchAccessor.js";
import { createProgressAccessor } from "../data/progressAccessor.js";
import { createRoomAccessor } from "../data/roomAccessor.js";
import { createAccountComponent } from "../domain/accounts/accountComponent.js";
import { createIdentityComponent } from "../domain/identity/identityComponent.js";
import { createMatchComponent } from "../domain/matches/matchComponent.js";
import { createProgressionComponent } from "../domain/progression/progressionComponent.js";
import { createRoomComponent } from "../domain/rooms/roomComponent.js";
import { createInMemoryRoomDao } from "../persistence/inMemoryRoomDao.js";
import { connectMatchPipeline, seatHandoverOnSignIn } from "../server.js";
import { createHttpApp } from "../service/http/app.js";
import { createSessionMiddleware } from "../service/http/session.js";
import { createRealtimeGateway } from "../service/realtime/gateway.js";
import { createBackgroundTasks } from "../utils/backgroundTasks.js";
import { createPasswordHasher } from "../utils/passwordHasher.js";
import { captureLogger } from "./captureLogger.js";
import { createInMemoryAccountDao } from "./inMemoryAccountDao.js";
import { createInMemoryLegacyUserDao } from "./inMemoryLegacyUserDao.js";
import { createInMemoryMatchDao } from "./inMemoryMatchDao.js";
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
 * }} [options]
 */
export function createTestApp({
  env = {},
  guestLimit,
  authLimits,
  engines = [raceEngine],
  legacyUsers = [],
  isDatabaseUp = () => true,
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
  const matchComponent = createMatchComponent({
    matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }),
  });
  const progressionComponent = createProgressionComponent({
    progressAccessor: createProgressAccessor({ progressDao: createInMemoryProgressDao() }),
    events: domainEvents,
  });
  const tasks = createBackgroundTasks({ logger: capture.logger });
  connectMatchPipeline({ domainEvents, matchComponent, progressionComponent, tasks, logger: capture.logger });
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
    accountComponent,
    authLimits,
    guestLimit,
    onSignedIn: seatHandoverOnSignIn({ roomComponent, domainEvents }),
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
    tasks,
    endedSessions,
    onSessionEnded: (listener) => endedListeners.push(listener),
    ...capture,
  };
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
  const testApp = createTestApp(options);
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
