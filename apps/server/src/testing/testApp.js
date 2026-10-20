import { EventEmitter } from "node:events";
import http from "node:http";
import session from "express-session";
import { BOTS, createBotRegistry, createBotThinker, createEngineRegistry } from "@classicade/games";
import { raceEngine } from "@classicade/games/testing";
import { createAccountAccessor } from "../data/accountAccessor.js";
import { createAccountDeletionAccessor, createSessionAccessor } from "../data/accountDeletionAccessor.js";
import { createBlockAccessor } from "../data/blockAccessor.js";
import { createFeedbackAccessor } from "../data/feedbackAccessor.js";
import { createDailyPuzzleAccessor } from "../data/dailyPuzzleAccessor.js";
import { createChessRatingAccessor } from "../data/chessRatingAccessor.js";
import { createAnalyticsAccessor } from "../data/analyticsAccessor.js";
import { createGamificationAccessor } from "../data/gamificationAccessor.js";
import { createLeaderboardAccessor } from "../data/leaderboardAccessor.js";
import { createLegacyUserAccessor } from "../data/legacyUserAccessor.js";
import { GUEST_NAME_ALPHABET } from "../models/identity.js";
import { createMatchAccessor } from "../data/matchAccessor.js";
import { createPendingMatchAccessor } from "../data/pendingMatchAccessor.js";
import { createPlayerTransferAccessor } from "../data/playerTransferAccessor.js";
import { createProgressAccessor } from "../data/progressAccessor.js";
import { createRoomAccessor } from "../data/roomAccessor.js";
import { createAccountComponent } from "../domain/accounts/accountComponent.js";
import { createPlayerDataComponent } from "../domain/accounts/playerDataComponent.js";
import { createAnalyticsComponent } from "../domain/analytics/analyticsComponent.js";
import { createBlockComponent } from "../domain/blocks/blockComponent.js";
import { createFeedbackComponent } from "../domain/feedback/feedbackComponent.js";
import { createChessKind } from "../domain/dailyPuzzles/chessKind.js";
import { createDailyPuzzleComponent } from "../domain/dailyPuzzles/dailyPuzzleComponent.js";
import { INDIA_CALENDAR } from "../domain/dailyPuzzles/schedule.js";
import { createBotComponent } from "../domain/bots/botComponent.js";
import { createBotDriver } from "../domain/bots/botDriver.js";
import { createBotTurns } from "../domain/bots/botTurns.js";
import { createSealMaker, sealSecretFrom } from "../domain/bots/seals.js";
import { createThinkingQueue } from "../domain/bots/thinkingQueue.js";
import { inProcessThinking } from "./inProcessThinking.js";
import { createGamificationComponent } from "../domain/gamification/gamificationComponent.js";
import { createIdentityComponent } from "../domain/identity/identityComponent.js";
import { createPlayerTransferComponent } from "../domain/identity/playerTransferComponent.js";
import { createLeaderboardComponent } from "../domain/leaderboards/leaderboardComponent.js";
import { createMatchComponent } from "../domain/matches/matchComponent.js";
import { createMatchPlayerIds, matchPlayerSecretFrom } from "../domain/matches/matchPlayerIds.js";
import { createMatchOutboxComponent } from "../domain/matches/matchOutboxComponent.js";
import { createProgressionComponent } from "../domain/progression/progressionComponent.js";
import { createChessRatingComponent } from "../domain/ratings/chessRatingComponent.js";
import { createRoomComponent, ROOM_EVENTS } from "../domain/rooms/roomComponent.js";
import { createSeatIds, seatSecretFrom } from "../domain/rooms/seatIds.js";
import { createInMemoryRoomDao } from "./inMemoryRoomDao.js";
import {
  connectLeaderboardBonuses,
  connectMatchPipeline,
  identityFollowers,
  keepFinishedGameIn,
  matchPipelineSteps,
  roomErasure,
} from "../server.js";
import { createHttpApp } from "../service/http/app.js";
import { createSessionCheck, createSessionMiddleware } from "../service/http/session.js";
import { createRealtimeGateway } from "../service/realtime/gateway.js";
import { createBackgroundTasks } from "../utils/backgroundTasks.js";
import { createNetworkKey } from "../utils/networkKey.js";
import { createLegacyPasswordChecker } from "../utils/legacyPassword.js";
import { createPasswordHasher } from "../utils/passwordHasher.js";
import { createTtlCache } from "../utils/ttlCache.js";
import { createEmptyAnalyticsDao } from "./emptyAnalyticsDao.js";
import { captureLogger } from "./captureLogger.js";
import { createInMemoryAccountDao } from "./inMemoryAccountDao.js";
import { createInMemoryAccountDeletionDao } from "./inMemoryAccountDeletionDao.js";
import { createInMemoryBlockDao } from "./inMemoryBlockDao.js";
import { createInMemoryFeedbackDao } from "./inMemoryFeedbackDao.js";
import { TEST_CHESS_PUZZLES } from "./dailyPuzzleSet.js";
import { createInMemoryDailyPuzzleAttemptDao } from "./inMemoryDailyPuzzleAttemptDao.js";
import { createInMemoryChessRatingDao } from "./inMemoryChessRatingDao.js";
import { createMemoryStoreSessionDao } from "./memoryStoreSessionDao.js";
import {
  createInMemoryAchievementDao,
  createInMemoryQuestDao,
  createInMemoryStatsDao,
} from "./inMemoryGamificationDaos.js";
import { createInMemoryLeaderboardDao } from "./inMemoryLeaderboardDao.js";
import { createInMemoryLegacyUserDao } from "./inMemoryLegacyUserDao.js";
import { createInMemoryMatchDao } from "./inMemoryMatchDao.js";
import { createInMemoryPendingMatchDao } from "./inMemoryPendingMatchDao.js";
import { createInMemoryPlayerTransferDao } from "./inMemoryPlayerTransferDao.js";
import { createInMemoryProgressDao } from "./inMemoryProgressDao.js";
import { reportOldEmailSpellings } from "../server.js";
import { testConfig } from "./testConfig.js";

/**
 * Wires the app the same way the composition root does, but with in-memory stores (sessions, rooms,
 * matches, the match pipeline's outbox), deterministic guests and seed 42: fast tests without a database.
 *
 * @param {{
 *   env?: Record<string, string>,
 *   buildInfoText?: string,   the build file the server reads at boot (CC-303), none by default
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
 *   pendingMatchDao?: ReturnType<typeof createInMemoryPendingMatchDao>,   the match pipeline's outbox, which a test
 *     can make fail (CC-111)
 *   accountLimits?: object,   the export and password limits of the account routes (CC-035)
 *   dataParticipants?: (participants: ReadonlyArray<object>) => ReadonlyArray<object>,  lets a test change who takes
 *     part in deleting an account (e.g. one that fails, CC-035)
 *   blockLimits?: object,   the limits on blocking and unblocking (CC-044)
 *   feedbackLimits?: object,   the limits on sending feedback (CC-290)
 *   dailyPuzzleLimit?: { windowMs: number, limit: number },   daily puzzle moves and hints per player (CC-144)
 *   chessPuzzles?: ReadonlyArray<object>,   the daily chess puzzles, two known ones unless a test gives its own
 *   dailyPuzzleAttemptDao?: ReturnType<typeof createInMemoryDailyPuzzleAttemptDao>,   lets a test make a change conflict
 *   metrics?: Partial<import("../utils/operationsMetrics.js").OperationsMetrics>,   a fake of operations telemetry,
 *     to see what the service layer records (ADR-055)
 * }} [options]
 */
export function createTestApp({
  env = {},
  buildInfoText = "",
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
  pendingMatchDao = createInMemoryPendingMatchDao(),
  accountLimits,
  dataParticipants = (participants) => participants,
  blockLimits,
  feedbackLimits,
  dailyPuzzleLimit,
  chessPuzzles = TEST_CHESS_PUZZLES,
  dailyPuzzleAttemptDao = createInMemoryDailyPuzzleAttemptDao(),
  metrics = {},
} = {}) {
  const config = testConfig(env, { buildInfoText });
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
    // Counted in the guest name alphabet, so the boards show test guests as server-given names (ADR-060).
    generateGuestSuffix: () =>
      `T${[2, 1, 0].map((place) => GUEST_NAME_ALPHABET[Math.floor(guestNumber / 32 ** place) % 32]).join("")}`,
  });
  const accountAccessor = createAccountAccessor({ accountDao });
  const legacyUserAccessor = createLegacyUserAccessor({
    legacyUserDao: createInMemoryLegacyUserDao(legacyUsers),
  });
  const accountDeletionAccessor = createAccountDeletionAccessor({
    accountDeletionDao: createInMemoryAccountDeletionDao(),
  });
  const accountComponent = createAccountComponent({
    accountAccessor,
    legacyUserAccessor,
    passwordHasher: createPasswordHasher({ params: { N: 2 ** 10, r: 8, p: 1 } }), // fast for tests
    legacyPasswords: createLegacyPasswordChecker({ dummyCost: 4 }),
    accountDeletionAccessor,
  });
  const domainEvents = new EventEmitter();
  const matchAccessor = createMatchAccessor({ matchDao: createInMemoryMatchDao() });
  const progressAccessor = createProgressAccessor({ progressDao: createInMemoryProgressDao() });
  const matchComponent = createMatchComponent({
    matchAccessor,
    matchPlayerIds: createMatchPlayerIds({ secret: matchPlayerSecretFrom(config.sessionSecret) }),
  });
  const roomAccessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  const playerTransferAccessor = createPlayerTransferAccessor({
    playerTransferDao: createInMemoryPlayerTransferDao(),
  });
  const seatIds = createSeatIds({ secret: seatSecretFrom(config.sessionSecret) });
  const blockComponent = createBlockComponent({
    blockAccessor: createBlockAccessor({ blockDao: createInMemoryBlockDao() }),
    rooms: roomAccessor,
    matches: matchComponent,
    transfers: playerTransferAccessor,
    seatIds,
  });
  const dailyPuzzleComponent = createDailyPuzzleComponent({
    dailyPuzzleAccessor: createDailyPuzzleAccessor({ attemptDao: dailyPuzzleAttemptDao, catalogues: {} }),
    kinds: [createChessKind({ puzzles: chessPuzzles })],
    calendar: INDIA_CALENDAR,
  });
  const progressionComponent = createProgressionComponent({
    progressAccessor,
    matchAccessor,
    events: domainEvents,
  });
  const feedbackComponent = createFeedbackComponent({
    feedbackAccessor: createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() }),
    ages: accountComponent,
  });
  const leaderboardComponent = createLeaderboardComponent({
    leaderboardAccessor: createLeaderboardAccessor({ leaderboardDao: createInMemoryLeaderboardDao() }),
    matchAccessor,
    progressAccessor,
    transfers: playerTransferAccessor,
    ages: accountComponent,
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
  const chessRatingComponent = createChessRatingComponent({
    chessRatingAccessor: createChessRatingAccessor({ chessRatingDao: createInMemoryChessRatingDao() }),
    events: domainEvents,
  });
  const playerTransferComponent = createPlayerTransferComponent({
    playerTransferAccessor,
    participants: transferParticipants([
      { name: "matches", transferPlayer: matchComponent.transferPlayer },
      { name: "progress", transferPlayer: progressionComponent.transferPlayer },
      { name: "chessRatings", transferPlayer: chessRatingComponent.transferPlayer },
      { name: "gamification", transferPlayer: gamificationComponent.transferPlayer },
      { name: "blocks", transferPlayer: blockComponent.transferPlayer },
      { name: "dailyPuzzles", transferPlayer: dailyPuzzleComponent.transferPlayer },
      { name: "leaderboards", transferPlayer: leaderboardComponent.transferPlayer },
    ]),
    matches: matchComponent,
  });
  const sessionAccessor = createSessionAccessor({ sessionDao: createMemoryStoreSessionDao({ store }) });
  const tasks = createBackgroundTasks({ logger: capture.logger });
  const outbox = createMatchOutboxComponent({
    pendingMatchAccessor: createPendingMatchAccessor({ pendingMatchDao }),
    steps: matchPipelineSteps({
      matchComponent,
      playerTransferComponent,
      progressionComponent,
      gamificationComponent,
      leaderboardComponent,
      chessRatingComponent,
      logger: capture.logger,
    }),
  });
  const engineRegistry = createEngineRegistry(engines);
  const botRegistry = createBotRegistry(BOTS.filter((bot) => engineRegistry.has(bot.gameId)));
  const botTurns = createBotTurns({
    bots: botRegistry,
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
    keepFinishedGame: keepFinishedGameIn({ outbox, matchComponent, now }),
    blocks: blockComponent,
    seatIds,
  });
  const botComponent = createBotComponent({ roomComponent, roomAccessor, events: domainEvents });
  // Computer players act at once in tests, so a test only waits for the server, never for a pause.
  const botDriver = createBotDriver({
    roomComponent,
    roomAccessor,
    botTurns,
    botComponent,
    thinking: createThinkingQueue({
      thinker: createBotThinker(botRegistry),
      workers: inProcessThinking(createBotThinker(botRegistry)),
      logger: capture.logger,
    }),
    events: domainEvents,
    delayMs: () => 0,
    logger: capture.logger,
    retryMs: 10,
    now,
  });
  domainEvents.on(ROOM_EVENTS.CHANGED, ({ room }) => botDriver.watch(room));
  const matchPipeline = connectMatchPipeline({
    domainEvents,
    matchComponent,
    roomComponent,
    outbox,
    tasks,
    logger: capture.logger,
    now,
  });
  connectLeaderboardBonuses({ domainEvents, leaderboardComponent, tasks, now });
  // The same stores, in the same order, as the composition root (CC-035).
  const playerDataComponent = createPlayerDataComponent({
    accountComponent,
    accountDeletionAccessor,
    formerIdsOf: playerTransferComponent.guestsOf,
    participants: dataParticipants([
      roomErasure({ roomComponent, domainEvents }),
      { name: "pendingMatches", erasePlayer: outbox.erasePlayer },
      {
        name: "sessions",
        erasePlayer: async ({ playerId }) => ({
          erased: { sessions: await sessionAccessor.removePlayer(playerId) },
        }),
      },
      { name: "matches", erasePlayer: matchComponent.erasePlayer, exportPlayer: matchComponent.exportPlayer },
      {
        name: "progress",
        erasePlayer: progressionComponent.erasePlayer,
        exportPlayer: progressionComponent.exportPlayer,
      },
      {
        name: "chessRatings",
        erasePlayer: chessRatingComponent.erasePlayer,
        exportPlayer: chessRatingComponent.exportPlayer,
      },
      {
        name: "gamification",
        erasePlayer: gamificationComponent.erasePlayer,
        exportPlayer: gamificationComponent.exportPlayer,
      },
      {
        name: "leaderboards",
        erasePlayer: leaderboardComponent.erasePlayer,
        exportPlayer: leaderboardComponent.exportPlayer,
      },
      {
        name: "guestTransfers",
        erasePlayer: playerTransferComponent.erasePlayer,
        exportPlayer: playerTransferComponent.exportPlayer,
      },
      { name: "blocks", erasePlayer: blockComponent.erasePlayer, exportPlayer: blockComponent.exportPlayer },
      {
        name: "dailyPuzzles",
        erasePlayer: dailyPuzzleComponent.erasePlayer,
        exportPlayer: dailyPuzzleComponent.exportPlayer,
      },
    ]),
  });
  const endedSessions = [];
  const endedListeners = [];
  const otherSessionsEnded = [];
  const otherEndedListeners = [];
  const deletedListeners = [];
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
    playerDataComponent,
    accountLimits,
    onAccountDeleted: (playerId) => deletedListeners.forEach((listener) => listener(playerId)),
    authLimits,
    guestLimit,
    now,
    leaderboardComponent,
    leaderboardLimit,
    apiLimit,
    blockComponent,
    blockLimits,
    feedbackComponent,
    feedbackLimits,
    dailyPuzzleComponent,
    dailyPuzzleLimit,
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
    ...(metrics.recordHttpRequest && { recordRequest: metrics.recordHttpRequest }),
  });

  return {
    app,
    config,
    store,
    accountDao,
    /** What the server does at boot with stored emails in an older spelling (CC-245). */
    loadOldEmailSpellings: () =>
      reportOldEmailSpellings({ accountAccessor, legacyUserAccessor, logger: capture.logger }),
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
    chessRatingComponent,
    blockComponent,
    feedbackComponent,
    dailyPuzzleComponent,
    matchPipeline,
    playerDataComponent,
    tasks,
    endedSessions,
    otherSessionsEnded,
    checkSession,
    onSessionEnded: (listener) => endedListeners.push(listener),
    onOtherSessionsEnded: (listener) => otherEndedListeners.push(listener),
    onAccountDeleted: (listener) => deletedListeners.push(listener),
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
  await testApp.loadOldEmailSpellings();
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
    networkOf: createNetworkKey({ now }).networkOf,
    now,
    ...(options.roomLimits && { limits: options.roomLimits }),
    botComponent: testApp.botComponent,
    chessRatingComponent: testApp.chessRatingComponent,
    ...(options.metrics?.recordSocketEvent && { recordSocketEvent: options.metrics.recordSocketEvent }),
  });
  testApp.onSessionEnded((sessionId) => gateway.disconnectSession(sessionId));
  testApp.onOtherSessionsEnded((which) => gateway.disconnectOtherSessions(which));
  testApp.onAccountDeleted((playerId) => gateway.disconnectPlayer(playerId));
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
