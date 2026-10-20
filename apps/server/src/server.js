import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { BOTS, createBotRegistry, createBotThinker, createEngineRegistry, ENGINES } from "@classicade/games";
import { DAILY_PUZZLE_KINDS, getGame, IDENTITY_KINDS } from "@classicade/shared";
import { createAccountAccessor } from "./data/accountAccessor.js";
import { createAccountDeletionAccessor, createSessionAccessor } from "./data/accountDeletionAccessor.js";
import { createBlockAccessor } from "./data/blockAccessor.js";
import { createFeatureFlagAccessor } from "./data/featureFlagAccessor.js";
import { createFeedbackAccessor } from "./data/feedbackAccessor.js";
import { createDailyPuzzleAccessor } from "./data/dailyPuzzleAccessor.js";
import { createChessRatingAccessor } from "./data/chessRatingAccessor.js";
import { createProfileAccessor } from "./data/profileAccessor.js";
import { createAnalyticsAccessor } from "./data/analyticsAccessor.js";
import { createGamificationAccessor } from "./data/gamificationAccessor.js";
import { createLeaderboardAccessor } from "./data/leaderboardAccessor.js";
import { createLegacyUserAccessor } from "./data/legacyUserAccessor.js";
import { createMatchAccessor } from "./data/matchAccessor.js";
import { createPendingMatchAccessor } from "./data/pendingMatchAccessor.js";
import { createPlayerTransferAccessor } from "./data/playerTransferAccessor.js";
import { createProgressAccessor } from "./data/progressAccessor.js";
import { createRoomAccessor } from "./data/roomAccessor.js";
import { createAccountComponent } from "./domain/accounts/accountComponent.js";
import { createPlayerDataComponent } from "./domain/accounts/playerDataComponent.js";
import { createAnalyticsComponent, REPORT_TTL_MS } from "./domain/analytics/analyticsComponent.js";
import { assertCharactersPlayable, createBotComponent } from "./domain/bots/botComponent.js";
import { createBotDriver, HUMAN_PAUSE_MS, pauseBetween } from "./domain/bots/botDriver.js";
import { createBlockComponent } from "./domain/blocks/blockComponent.js";
import { createProfileCards } from "./domain/profiles/profileCards.js";
import { createProfileComponent } from "./domain/profiles/profileComponent.js";
import { createSafetyComponent } from "./domain/safety/safetyComponent.js";
import { createFeedbackComponent } from "./domain/feedback/feedbackComponent.js";
import { createFlagComponent } from "./domain/flags/flagComponent.js";
import { createChessKind } from "./domain/dailyPuzzles/chessKind.js";
import { createDailyPuzzleComponent } from "./domain/dailyPuzzles/dailyPuzzleComponent.js";
import { INDIA_CALENDAR } from "./domain/dailyPuzzles/schedule.js";
import { createBotTurns } from "./domain/bots/botTurns.js";
import { createSealMaker, sealSecretFrom } from "./domain/bots/seals.js";
import { createThinkingQueue } from "./domain/bots/thinkingQueue.js";
import { createBotThinkingClient } from "./dependency/thinking/botThinkingClient.js";
import { createGamificationComponent } from "./domain/gamification/gamificationComponent.js";
import { createIdentityComponent } from "./domain/identity/identityComponent.js";
import { createPlayerTransferComponent } from "./domain/identity/playerTransferComponent.js";
import { createLeaderboardComponent } from "./domain/leaderboards/leaderboardComponent.js";
import { createChessRatingComponent } from "./domain/ratings/chessRatingComponent.js";
import { createMatchComponent } from "./domain/matches/matchComponent.js";
import { createMatchPlayerIds, matchPlayerSecretFrom } from "./domain/matches/matchPlayerIds.js";
import { createMatchOutboxComponent, matchRetryPolicy } from "./domain/matches/matchOutboxComponent.js";
import {
  createProgressionComponent,
  PROGRESSION_EVENTS,
  XP_SOURCES,
} from "./domain/progression/progressionComponent.js";
import { createRoomComponent, ROOM_EVENTS } from "./domain/rooms/roomComponent.js";
import { roomLifetimes } from "./domain/rooms/roomLifetimes.js";
import { roomLimits } from "./domain/rooms/roomLimits.js";
import { createSeatIds, seatSecretFrom } from "./domain/rooms/seatIds.js";
import { deletedPlayer } from "./models/deletedPlayer.js";
import { createAccountDao } from "./persistence/accountDao.js";
import { createAccountDeletionDao } from "./persistence/accountDeletionDao.js";
import { createAchievementDao } from "./persistence/achievementDao.js";
import { createAnalyticsDao } from "./persistence/analyticsDao.js";
import { connectDatabase } from "./persistence/database.js";
import { createBlockDao } from "./persistence/blockDao.js";
import { createFeatureFlagDao } from "./persistence/featureFlagDao.js";
import { createFeedbackDao } from "./persistence/feedbackDao.js";
import { createDailyPuzzleAttemptDao } from "./persistence/dailyPuzzleAttemptDao.js";
import { loadChessPuzzles } from "./persistence/puzzleCatalog.js";
import { createLeaderboardDao } from "./persistence/leaderboardDao.js";
import { createChessRatingDao } from "./persistence/chessRatingDao.js";
import { createProfileDao } from "./persistence/profileDao.js";
import { createLegacyUserDao } from "./persistence/legacyUserDao.js";
import { createMatchDao } from "./persistence/matchDao.js";
import { createPendingMatchDao } from "./persistence/pendingMatchDao.js";
import { createPlayerTransferDao } from "./persistence/playerTransferDao.js";
import { createProgressDao } from "./persistence/progressDao.js";
import { createQuestDao } from "./persistence/questDao.js";
import { createRoomDao } from "./persistence/roomDao.js";
import { createSessionDao } from "./persistence/sessionDao.js";
import { createSessionStore } from "./persistence/sessionStore.js";
import { createStatsDao } from "./persistence/statsDao.js";
import { createHttpApp } from "./service/http/app.js";
import { createSessionCheck, createSessionMiddleware, SESSION_TTL_SECONDS } from "./service/http/session.js";
import { createRealtimeGateway } from "./service/realtime/gateway.js";
import { assertFunction } from "./utils/assert.js";
import { createBackgroundTasks } from "./utils/backgroundTasks.js";
import { createKeyedIds, KEYED_ID_LABELS, keyedIdSecretFrom } from "./utils/keyedIds.js";
import { createLegacyPasswordChecker } from "./utils/legacyPassword.js";
import { createNetworkKey, dropOldNetworkKeysEveryMidnight } from "./utils/networkKey.js";
import { createPasswordHasher } from "./utils/passwordHasher.js";
import { NO_OPERATIONS_METRICS } from "./utils/operationsMetrics.js";
import { createTtlCache } from "./utils/ttlCache.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
// The time the last flush of telemetry gets before the process exits. With the drain above it stays well inside
// the 30 seconds Render waits after SIGTERM (CC-305).
const FINAL_FLUSH_MS = 5_000;
const SESSION_ENDED = "sessionEnded";
const OTHER_SESSIONS_ENDED = "otherSessionsEnded";
const ACCOUNT_DELETED = "accountDeleted";
const ROOM_SWEEP_INTERVAL_MS = 60_000;
const GAUGE_INTERVAL_MS = 60_000;
const CLOCK_TICK_INTERVAL_MS = 1_000;
const TRANSFER_RESUME_INTERVAL_MS = 60_000;
// How often the match pipeline looks for games whose next attempt is due (CC-111).
const MATCH_PIPELINE_INTERVAL_MS = 5_000;
// How often finished rooms are checked for a game the match pipeline never got (CC-111).
const FINISHED_ROOMS_INTERVAL_MS = 60_000;
const DELETION_SWEEP_INTERVAL_MS = 60_000;
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

/** The match pipeline's steps by name (CC-111). The logs and the stored outbox records use these names. */
export const MATCH_STEPS = Object.freeze({
  RECORD: "record match",
  JUDGE: "judge",
  PROGRESSION: "apply progression",
  GAMIFICATION: "apply gamification",
  LEADERBOARDS: "apply leaderboards",
  CHESS_RATINGS: "apply chess ratings",
});

/**
 * What happens after a game ends, as one flat list of named steps (CC-111, ADR-047):
 * 1. Record the match, so XP and the rest only ever come from a stored match.
 * 2. Judge it: a match recorded for a guest who has just signed in moves to their account first (CC-032), then it
 *    is judged once for fair play (CC-095). Every later step gives nothing to a player it does not count for.
 * 3. Apply progression: XP and levels.
 * 4. Apply gamification: achievements, streaks and quests (CC-054, CC-089).
 * 5. Apply leaderboards (CC-053). It needs progression but not gamification, so a failing gamification step does
 *    not keep the boards back.
 * 6. Apply chess ratings (CC-042, ADR-062). It needs only the verdict, so a failing XP or board step never holds a
 *    rating back.
 * Each step reads the match from storage and changes nothing when it runs again, so a game the outbox runs a
 * second time, after a failure or a restart, still counts once.
 *
 * @param {{
 *   matchComponent: Pick<ReturnType<typeof createMatchComponent>, "record" | "judge" | "getById">,
 *   playerTransferComponent: { follow: Function },
 *   progressionComponent: { applyMatch: Function },
 *   gamificationComponent: { applyMatch: Function },
 *   leaderboardComponent: { applyMatch: Function },
 *   chessRatingComponent: { applyMatch: Function },
 *   logger: Logger,
 * }} deps
 * @returns {ReadonlyArray<import("./domain/matches/matchOutboxComponent.js").MatchStep>}
 */
export function matchPipelineSteps({
  matchComponent,
  playerTransferComponent,
  progressionComponent,
  gamificationComponent,
  leaderboardComponent,
  chessRatingComponent,
  logger,
}) {
  const stored = (matchId) => matchComponent.getById(matchId);
  return Object.freeze([
    {
      name: MATCH_STEPS.RECORD,
      async run({ match }) {
        const recorded = await matchComponent.record(match);
        logger.info(
          { matchId: recorded.matchId, gameId: recorded.gameId, reason: recorded.result.reason },
          "match recorded",
        );
      },
    },
    {
      name: MATCH_STEPS.JUDGE,
      needs: [MATCH_STEPS.RECORD],
      // Judged after following, so the fair play limits look at the players as they are now (CC-095).
      run: async ({ matchId, now }) =>
        matchComponent.judge(await playerTransferComponent.follow({ match: await stored(matchId), now })),
    },
    {
      name: MATCH_STEPS.PROGRESSION,
      needs: [MATCH_STEPS.JUDGE],
      async run({ matchId }) {
        const judged = await stored(matchId);
        const updates = await progressionComponent.applyMatch(judged);
        logger.info(
          {
            matchId,
            players: updates.length,
            notCounted: judged.credit.notCounted.map(({ reason }) => reason),
          },
          "progression applied",
        );
      },
    },
    {
      name: MATCH_STEPS.GAMIFICATION,
      needs: [MATCH_STEPS.PROGRESSION],
      async run({ matchId, now }) {
        await gamificationComponent.applyMatch({ match: await stored(matchId), now });
        logger.info({ matchId }, "gamification applied");
      },
    },
    {
      name: MATCH_STEPS.LEADERBOARDS,
      needs: [MATCH_STEPS.PROGRESSION],
      async run({ matchId }) {
        await leaderboardComponent.applyMatch({ match: await stored(matchId) });
        logger.info({ matchId }, "leaderboards applied");
      },
    },
    {
      name: MATCH_STEPS.CHESS_RATINGS,
      needs: [MATCH_STEPS.JUDGE],
      async run({ matchId }) {
        const ratings = await chessRatingComponent.applyMatch({ match: await stored(matchId) });
        if (ratings.length > 0) logger.info({ matchId, players: ratings.length }, "chess ratings applied");
      },
    },
  ]);
}

/**
 * Logs what one run of a game through the match pipeline did. A step that failed for good is logged at error
 * level as "match pipeline failed": that line is the alert (CC-049). Each failed attempt before it is a warning
 * with the time of the next attempt.
 *
 * @param {Logger} logger
 * @param {import("./domain/matches/matchOutboxComponent.js").RunOutcome} outcome
 */
export function logPipelineOutcome(logger, outcome) {
  const { matchId } = outcome;
  if (outcome.status === "done" && outcome.ran.length > 0) {
    logger.info({ matchId, steps: outcome.ran }, "match pipeline done");
  } else if (outcome.status === "retrying") {
    const { error, step, attempts, nextAttemptAt } = outcome;
    logger.warn(
      { err: error, matchId, step, attempts, nextAttemptAt },
      "match pipeline step failed, will retry",
    );
  } else if (outcome.status === "failed" && Object.hasOwn(outcome, "step")) {
    const { error, step, attempts } = outcome;
    logger.error({ err: error, matchId, step, attempts, alert: true }, "match pipeline failed");
  }
}

/**
 * Tells operations telemetry what one run of a game through the match pipeline tried (ADR-055): one attempt for
 * each step that went through, one for the step that failed, and that step marked as failed for good when no
 * attempt is left. A run that changed nothing counts nothing.
 *
 * @param {import("./utils/operationsMetrics.js").OperationsMetrics["recordPipelineStep"]} recordPipelineStep
 * @param {import("./domain/matches/matchOutboxComponent.js").RunOutcome} outcome
 */
export function countPipelineOutcome(recordPipelineStep, outcome) {
  (outcome.ran ?? []).forEach((step) => recordPipelineStep({ step, failedForGood: false }));
  if (Object.hasOwn(outcome, "step")) {
    recordPipelineStep({ step: outcome.step, failedForGood: outcome.status === "failed" });
  }
}

/**
 * Stores a finished game in the match pipeline's outbox, unless the outbox has it already (CC-111). The room
 * component calls it before any change to a finished room, so a rematch or a closing room never takes a game with
 * it that the outbox does not have yet.
 *
 * @param {{
 *   outbox: Pick<ReturnType<typeof createMatchOutboxComponent>, "add">,
 *   matchComponent: Pick<ReturnType<typeof createMatchComponent>, "finishedMatch">,
 *   now?: () => number,
 * }} deps
 * @returns {(game: { room: object, outcome: object }) => Promise<boolean>} whether the game was added now
 */
export const keepFinishedGameIn =
  ({ outbox, matchComponent, now = Date.now }) =>
  (game) =>
    outbox.add({ match: matchComponent.finishedMatch(game), now: now() });

/**
 * After a game ends, its match goes into the match pipeline's outbox and runs at once (CC-111, ADR-047). The
 * outbox keeps it in MongoDB until every step is done, so a database blip or a crash never loses it. Everything
 * runs as background work, so a slow database never delays a game, and shutdown waits for it.
 *
 * The finished room is the record of a game until its outbox entry exists. The room component keeps the game
 * before the room changes (see `keepFinishedGameIn`). `addFinishedRooms` adds the game of every finished room
 * again (nothing changes for one the outbox has), at startup before anything can close a room, and every minute.
 * Together they cover a crash or a blip between saving the finished room and adding its game.
 * `runDue` runs the games whose next attempt has come.
 *
 * @param {{
 *   domainEvents: import("node:events").EventEmitter,
 *   matchComponent: Pick<ReturnType<typeof createMatchComponent>, "finishedMatch">,
 *   roomComponent: Pick<ReturnType<typeof createRoomComponent>, "listFinishedGames">,
 *   outbox: ReturnType<typeof createMatchOutboxComponent>,
 *   tasks: ReturnType<typeof createBackgroundTasks>,
 *   logger: Logger,
 *   now?: () => number,
 *   recordPipelineStep?: import("./utils/operationsMetrics.js").OperationsMetrics["recordPipelineStep"],
 * }} deps  `recordPipelineStep` counts attempts for operations telemetry, and does nothing unless it is on
 * @returns {{ addFinishedRooms: () => Promise<number>, runDue: () => void }}
 */
export function connectMatchPipeline({
  domainEvents,
  matchComponent,
  roomComponent,
  outbox,
  tasks,
  logger,
  now = Date.now,
  recordPipelineStep = NO_OPERATIONS_METRICS.recordPipelineStep,
}) {
  const report = (outcome) => {
    logPipelineOutcome(logger, outcome);
    countPipelineOutcome(recordPipelineStep, outcome);
  };
  domainEvents.on(ROOM_EVENTS.GAME_FINISHED, (event) => {
    const match = matchComponent.finishedMatch(event);
    tasks.run(
      "match pipeline",
      async () => {
        await outbox.add({ match, now: now() });
        report(await outbox.run({ matchId: match.matchId, now: now() }));
      },
      { matchId: match.matchId, roomCode: event.room.code },
    );
  });

  const keep = keepFinishedGameIn({ outbox, matchComponent, now });
  return Object.freeze({
    async addFinishedRooms() {
      let added = 0;
      for (const game of await roomComponent.listFinishedGames()) {
        if (await keep(game)) added += 1;
      }
      // A finished game the pipeline never got: its announcement was lost to a crash or a blip.
      if (added > 0) logger.warn({ added }, "finished games added to the match pipeline late");
      return added;
    },
    runDue() {
      tasks.run("match pipeline", async () => {
        (await outbox.runDue({ now: now() })).forEach(report);
      });
    },
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
 * moves), finish moving guests' data to their accounts where that was interrupted (CC-032), and keep the match
 * pipeline going (CC-111): games whose next attempt is due every few seconds, finished rooms whose game it never
 * got every minute. Each account deletion is swept once more a few minutes after it was asked (CC-035). With the room sweep, computer players plan again for every room, so one whose plan was dropped
 * after the database kept failing still moves (CC-138). A failing run is logged and the next one still happens.
 * Timers don't keep the process alive.
 *
 * Once a minute it also logs a gauge: how many rooms are open in each status and how many realtime connections and
 * players there are (CC-107). Operators read it to see how close the server is to its limits (roomLimits.js).
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof createRoomComponent>, "sweepExpired" | "expireDue" | "countRooms">,
 *   playerTransferComponent: Pick<ReturnType<typeof createPlayerTransferComponent>, "resumePending">,
 *   matchPipeline: ReturnType<typeof connectMatchPipeline>,
 *   playerDataComponent: Pick<ReturnType<typeof createPlayerDataComponent>, "sweepDue">,
 *   connections: () => { connections: number, players: number },
 *   botDriver: Pick<ReturnType<typeof createBotDriver>, "resume">,
 *   logger: Logger,
 *   now?: () => number,
 *   sweepIntervalMs?: number,
 *   pipelineIntervalMs?: number,
 * }} deps  `sweepIntervalMs` and `pipelineIntervalMs` are shorter only in tests that watch a room close or a
 *   game being retried
 * @returns {{ stop: () => void }}
 */
export function startHousekeeping({
  roomComponent,
  playerTransferComponent,
  matchPipeline,
  playerDataComponent,
  connections,
  botDriver,
  logger,
  now = Date.now,
  sweepIntervalMs = ROOM_SWEEP_INTERVAL_MS,
  pipelineIntervalMs = MATCH_PIPELINE_INTERVAL_MS,
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
    every(sweepIntervalMs, () => botDriver.resume(), "planning for computer players failed"),
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
    every(pipelineIntervalMs, () => matchPipeline.runDue(), "running the match pipeline failed"),
    every(
      FINISHED_ROOMS_INTERVAL_MS,
      () => matchPipeline.addFinishedRooms(),
      "adding finished games to the match pipeline failed",
    ),
    every(
      DELETION_SWEEP_INTERVAL_MS,
      async () => {
        const { completed, failed } = await playerDataComponent.sweepDue({ now: now() });
        completed.forEach((playerId) => logger.info({ playerId }, "account deletion swept again"));
        failed.forEach(({ playerId, error }) =>
          logger.error({ err: error, playerId }, "account deletion sweep failed"),
        );
      },
      "sweeping account deletions failed",
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
 * Reads, at boot, which stored emails are in a spelling the one email spelling changes (CC-245), so login and
 * sign-up still find them, and logs only how many there are. Each such account is rewritten at its next login, so
 * the first number falls to zero over time. Reads only emails outside plain ASCII, and only the email field.
 *
 * @param {{
 *   accountAccessor: Pick<ReturnType<typeof createAccountAccessor>, "loadEmailAliases">,
 *   legacyUserAccessor: Pick<ReturnType<typeof createLegacyUserAccessor>, "loadEmailAliases">,
 *   logger: Pick<import("./utils/logger.js").Logger, "info">,
 * }} deps
 * @returns {Promise<{ accounts: number, legacyUsers: number }>}
 */
export async function reportOldEmailSpellings({ accountAccessor, legacyUserAccessor, logger }) {
  const [accounts, legacyUsers] = await Promise.all([
    accountAccessor.loadEmailAliases(),
    legacyUserAccessor.loadEmailAliases(),
  ]);
  logger.info(
    { accounts, legacyUsers },
    `accounts with non-normal email: ${accounts}, legacy users with non-normal email: ${legacyUsers}`,
  );
  return { accounts, legacyUsers };
}

/**
 * Rooms take part in deleting an account (CC-035): in every room the player sits in, a new anonymous stand-in takes
 * their seat and leaves, and everyone in those rooms sees the change.
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof createRoomComponent>, "erasePlayer">,
 *   domainEvents: import("node:events").EventEmitter,
 *   newUuid?: () => string,
 * }} deps
 * @returns {import("./domain/accounts/playerDataComponent.js").PlayerDataParticipant}
 */
export function roomErasure({ roomComponent, domainEvents, newUuid = randomUUID }) {
  return {
    name: "rooms",
    async erasePlayer({ playerId, now }) {
      const rooms = await roomComponent.erasePlayer({
        playerId,
        standIn: () => deletedPlayer(newUuid()),
        now,
      });
      rooms.forEach((room) => domainEvents.emit(ROOM_EVENTS.UPDATED, { room }));
      return { erased: { rooms: rooms.length } };
    },
  };
}

/**
 * Composition root: builds every layer bottom-up, wires dependencies, and starts listening.
 * The only module allowed to know about all layers.
 *
 * @param {{
 *   config: Readonly<import("./config/index.js").Config>,
 *   logger: Logger,
 *   limits?: { auth?: object, guest?: { windowMs: number, limit: number }, leaderboard?: { windowMs: number, limit: number }, api?: { windowMs: number, limit: number }, blocks?: object, profiles?: object, feedback?: object },
 *     rate limits; production uses the
 *     defaults — only browser tests raise them, because every test player shares one IP
 *   now?: () => number,
 *   rooms?: {
 *     lifetimes?: Partial<import("./domain/rooms/roomLifetimes.js").RoomLifetimes>,
 *     limits?: Partial<import("./domain/rooms/roomLimits.js").RoomLimits>,
 *     sweepIntervalMs?: number,
 *   },
 *   bots?: {
 *     pauseMs?: { min: number, max: number },
 *     thinkingWorkers?: (options: { size: number, budgetMs: number }) => ReturnType<typeof createBotThinkingClient>,
 *   },
 *   pipeline?: {
 *     steps?: (steps: ReadonlyArray<import("./domain/matches/matchOutboxComponent.js").MatchStep>) => ReadonlyArray<import("./domain/matches/matchOutboxComponent.js").MatchStep>,
 *     policy?: Partial<typeof import("./domain/matches/matchOutboxComponent.js").MATCH_RETRY_POLICY>,
 *     intervalMs?: number,
 *   },
 *   metrics?: import("./utils/operationsMetrics.js").OperationsMetrics,  operations telemetry (ADR-055), from
 *     `startTelemetry`. Without it nothing is measured
 * }} deps  `now`, `rooms`, `bots` and `pipeline` are for tests only. Production runs on the real clock, the
 *   standard room lifetimes and limits, a human-like pause before each computer move and the standard match
 *   pipeline. Integration tests move the clock, let computer players act at once and make a pipeline step fail or
 *   stop, a shutdown test gives thinking threads that hang, and browser tests shorten lifetimes to watch a room close, raise the connections per address (every
 *   test player shares one) and fill the server on purpose.
 * @returns {Promise<{ server: http.Server, host: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({
  config,
  logger,
  limits = {},
  now = Date.now,
  rooms = {},
  bots = {},
  pipeline = {},
  metrics = NO_OPERATIONS_METRICS,
}) {
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
  const pendingMatchDao = createPendingMatchDao({ connection: database.connection });
  const accountDeletionDao = createAccountDeletionDao({ connection: database.connection });
  const blockDao = createBlockDao({ connection: database.connection });
  const feedbackDao = createFeedbackDao({ connection: database.connection });
  const dailyPuzzleAttemptDao = createDailyPuzzleAttemptDao({ connection: database.connection });
  const chessRatingDao = createChessRatingDao({ connection: database.connection });
  const profileDao = createProfileDao({ connection: database.connection });
  const featureFlagDao = createFeatureFlagDao({ connection: database.connection });
  const sessionDao = createSessionDao({ client: database.client });
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
      pendingMatchDao,
      accountDeletionDao,
      blockDao,
      feedbackDao,
      dailyPuzzleAttemptDao,
      chessRatingDao,
      profileDao,
      featureFlagDao,
    ].map((dao) => dao.ensureIndexes()),
  );

  // 3. data
  const roomAccessor = createRoomAccessor({ roomDao });
  const matchAccessor = createMatchAccessor({ matchDao });
  const progressAccessor = createProgressAccessor({ progressDao });
  const accountAccessor = createAccountAccessor({ accountDao });
  const legacyUserAccessor = createLegacyUserAccessor({ legacyUserDao });
  await reportOldEmailSpellings({ accountAccessor, legacyUserAccessor, logger });
  const playerTransferAccessor = createPlayerTransferAccessor({ playerTransferDao });
  const gamificationAccessor = createGamificationAccessor({ statsDao, questDao, achievementDao });
  const leaderboardAccessor = createLeaderboardAccessor({ leaderboardDao });
  const analyticsAccessor = createAnalyticsAccessor({ analyticsDao });
  const pendingMatchAccessor = createPendingMatchAccessor({ pendingMatchDao });
  const accountDeletionAccessor = createAccountDeletionAccessor({ accountDeletionDao });
  const sessionAccessor = createSessionAccessor({ sessionDao });
  const blockAccessor = createBlockAccessor({ blockDao });
  const feedbackAccessor = createFeedbackAccessor({ feedbackDao });
  const chessPuzzles = loadChessPuzzles();
  const dailyPuzzleAccessor = createDailyPuzzleAccessor({
    attemptDao: dailyPuzzleAttemptDao,
    catalogues: { [DAILY_PUZZLE_KINDS.CHESS]: chessPuzzles },
  });
  const chessRatingAccessor = createChessRatingAccessor({ chessRatingDao });
  const profileAccessor = createProfileAccessor({ profileDao });
  const featureFlagAccessor = createFeatureFlagAccessor({ featureFlagDao });

  // 2. domain
  assertEnginesInCatalog(ENGINES);
  const domainEvents = new EventEmitter();
  const identityComponent = createIdentityComponent();
  const accountComponent = createAccountComponent({
    accountAccessor,
    legacyUserAccessor,
    passwordHasher: createPasswordHasher(),
    legacyPasswords: createLegacyPasswordChecker(),
    accountDeletionAccessor,
  });
  // The under 18 defaults in one place: every social feature reads a player's age policy from here (CC-152).
  const safetyComponent = createSafetyComponent({ ages: accountComponent });
  // What rooms, boards and history show beside a name: an avatar, and an adult's profile link (CC-034).
  const profileCards = createProfileCards({ profileAccessor, safety: safetyComponent });
  const matchComponent = createMatchComponent({
    matchAccessor,
    matchPlayerIds: createMatchPlayerIds({ secret: matchPlayerSecretFrom(config.sessionSecret) }),
    cards: profileCards,
  });
  // One set of seat ids for rooms and blocks, so a seat id the room view shows is the one a block is checked against.
  const seatIds = createSeatIds({ secret: seatSecretFrom(config.sessionSecret) });
  const feedbackComponent = createFeedbackComponent({ feedbackAccessor, safety: safetyComponent });
  // Feature flags (CC-312). Making the component checks the registry, so a broken one stops the boot.
  const flagComponent = createFlagComponent({
    flagAccessor: featureFlagAccessor,
    keyedIds: createKeyedIds({
      secret: keyedIdSecretFrom({ sessionSecret: config.sessionSecret, label: KEYED_ID_LABELS.FLAG_BUCKETS }),
    }),
    safety: safetyComponent,
    logger,
    now,
  });
  await flagComponent.refresh();
  const blockComponent = createBlockComponent({
    blockAccessor,
    rooms: roomAccessor,
    matches: matchComponent,
    transfers: playerTransferAccessor,
    seatIds,
  });
  const progressionComponent = createProgressionComponent({
    progressAccessor,
    matchAccessor,
    events: domainEvents,
  });
  // The daily puzzles follow India days until CC-146 gives each player their own (ADR-061).
  const dailyPuzzleComponent = createDailyPuzzleComponent({
    dailyPuzzleAccessor,
    kinds: [createChessKind({ puzzles: dailyPuzzleAccessor.puzzlesOf(DAILY_PUZZLE_KINDS.CHESS) })],
    calendar: INDIA_CALENDAR,
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
    transfers: playerTransferAccessor,
    safety: safetyComponent,
    cards: profileCards,
  });
  const chessRatingComponent = createChessRatingComponent({ chessRatingAccessor, events: domainEvents });
  const profileComponent = createProfileComponent({
    profileAccessor,
    safety: safetyComponent,
    accounts: accountComponent,
    progress: progressionComponent,
    ratings: chessRatingComponent,
  });
  // Everything stored by player id moves with a guest who signs in (ADR-014), in this order. Leaderboards go
  // last: they are recomputed from the progress and matches that have moved by then.
  const playerTransferComponent = createPlayerTransferComponent({
    playerTransferAccessor,
    participants: [
      { name: "matches", transferPlayer: matchComponent.transferPlayer },
      { name: "progress", transferPlayer: progressionComponent.transferPlayer },
      { name: "chessRatings", transferPlayer: chessRatingComponent.transferPlayer },
      { name: "gamification", transferPlayer: gamificationComponent.transferPlayer },
      { name: "blocks", transferPlayer: blockComponent.transferPlayer },
      { name: "dailyPuzzles", transferPlayer: dailyPuzzleComponent.transferPlayer },
      { name: "profiles", transferPlayer: profileComponent.transferPlayer },
      { name: "leaderboards", transferPlayer: leaderboardComponent.transferPlayer },
    ],
    matches: matchComponent,
  });
  const analyticsComponent = createAnalyticsComponent({
    analyticsAccessor,
    cache: createTtlCache({ ttlMs: REPORT_TTL_MS, maxEntries: ANALYTICS_CACHED_REPORTS }),
  });
  const tasks = createBackgroundTasks({ logger });
  const steps = matchPipelineSteps({
    matchComponent,
    playerTransferComponent,
    progressionComponent,
    gamificationComponent,
    leaderboardComponent,
    chessRatingComponent,
    logger,
  });
  const outbox = createMatchOutboxComponent({
    pendingMatchAccessor,
    steps: pipeline.steps ? pipeline.steps(steps) : steps,
    policy: matchRetryPolicy(pipeline.policy),
  });
  const limitsOfRooms = roomLimits(rooms.limits);
  const engines = createEngineRegistry(ENGINES);
  const botRegistry = createBotRegistry(BOTS);
  assertCharactersPlayable(botRegistry);
  const botTurns = createBotTurns({
    bots: botRegistry,
    engines,
    sealMaker: createSealMaker({ secret: sealSecretFrom(config.sessionSecret) }),
  });
  const roomComponent = createRoomComponent({
    roomAccessor,
    engines,
    events: domainEvents,
    lifetimes: roomLifetimes(rooms.lifetimes),
    limits: limitsOfRooms,
    botTurns,
    keepFinishedGame: keepFinishedGameIn({ outbox, matchComponent, now }),
    blocks: blockComponent,
    seatIds,
    avatars: profileCards,
  });
  const botComponent = createBotComponent({ roomComponent, roomAccessor, events: domainEvents });
  // Heavy computer thinking runs on worker threads, off the event loop (ADR-067).
  const thinkingWorkers = (bots.thinkingWorkers ?? createBotThinkingClient)({
    size: config.bots.workers,
    budgetMs: config.bots.budgetMs,
  });
  const botDriver = createBotDriver({
    roomComponent,
    roomAccessor,
    botTurns,
    botComponent,
    thinking: createThinkingQueue({
      thinker: createBotThinker(botRegistry),
      workers: thinkingWorkers,
      logger,
      recordThinking: metrics.recordBotThinking,
    }),
    events: domainEvents,
    delayMs: pauseBetween(bots.pauseMs ?? HUMAN_PAUSE_MS),
    logger,
    now,
  });
  domainEvents.on(ROOM_EVENTS.CHANGED, ({ room }) => botDriver.watch(room));
  const matchPipeline = connectMatchPipeline({
    domainEvents,
    matchComponent,
    roomComponent,
    outbox,
    tasks,
    logger,
    now,
    recordPipelineStep: metrics.recordPipelineStep,
  });
  connectLeaderboardBonuses({ domainEvents, leaderboardComponent, tasks, now });
  // Deleting an account reaches every store of DATA.md, in this order (CC-035). Rooms go first, so a game the
  // player was in ends under a stand-in before the stores that game would write to are erased.
  const playerDataComponent = createPlayerDataComponent({
    accountComponent,
    accountDeletionAccessor,
    formerIdsOf: playerTransferComponent.guestsOf,
    participants: [
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
      {
        name: "profiles",
        erasePlayer: profileComponent.erasePlayer,
        exportPlayer: profileComponent.exportPlayer,
      },
    ],
  });

  // Rooms are stored, so they outlive this process (CC-101). First, a game that finished just before a crash
  // reaches the match pipeline while its room still shows it (CC-111). Nobody is connected to a process that has
  // only just started, and a chess flag may have fallen while no server was running: settle both before anyone
  // can join. A game that ends here is recorded through the match pipeline above. Then a computer player whose
  // turn it was when the last process stopped gets to move again (CC-138).
  try {
    await matchPipeline.addFinishedRooms();
    await roomComponent.markEveryoneAway({ now: now() });
    await roomComponent.expireDue({ now: now() });
    await botDriver.resume();
  } catch (err) {
    botDriver.stop();
    await thinkingWorkers.close();
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
    blockLimits: limits.blocks,
    blockComponent,
    profileLimits: limits.profiles,
    profileComponent,
    feedbackLimits: limits.feedback,
    feedbackComponent,
    dailyPuzzleComponent,
    safetyComponent,
    flagComponent,
    leaderboardComponent,
    analyticsComponent,
    sessionMiddleware,
    identityComponent,
    matchComponent,
    progressionComponent,
    gamificationComponent,
    accountComponent,
    playerDataComponent,
    now,
    onSessionEnded: (sessionId) => sessionEvents.emit(SESSION_ENDED, sessionId),
    onAccountDeleted: (playerId) => sessionEvents.emit(ACCOUNT_DELETED, playerId),
    onOtherSessionsEnded: (which) => sessionEvents.emit(OTHER_SESSIONS_ENDED, which),
    checkSession,
    onIdentityChanged: identityFollowers({ roomComponent, playerTransferComponent, domainEvents, now }),
    recordRequest: metrics.recordHttpRequest,
  });
  const server = http.createServer(app);
  const networkKey = createNetworkKey({ now });
  const gateway = createRealtimeGateway({
    httpServer: server,
    sessionMiddleware,
    allowedOrigins: config.allowedOrigins,
    logger,
    roomComponent,
    domainEvents,
    checkSession,
    trustProxyHops: config.trustProxyHops,
    networkOf: networkKey.networkOf,
    limits: limitsOfRooms,
    now,
    botComponent,
    chessRatingComponent,
    recordSocketEvent: metrics.recordSocketEvent,
  });
  // Read only when telemetry takes a reading, once a minute in production.
  metrics.watch({ rooms: roomComponent.countRoomsByGame, connections: () => gateway.counts().connections });
  sessionEvents.on(SESSION_ENDED, (sessionId) => gateway.disconnectSession(sessionId));
  sessionEvents.on(OTHER_SESSIONS_ENDED, (which) => gateway.disconnectOtherSessions(which));
  sessionEvents.on(ACCOUNT_DELETED, (playerId) => gateway.disconnectPlayer(playerId));

  const housekeeping = startHousekeeping({
    roomComponent,
    playerTransferComponent,
    matchPipeline,
    playerDataComponent,
    connections: gateway.counts,
    botDriver,
    logger,
    now,
    sweepIntervalMs: rooms.sweepIntervalMs,
    pipelineIntervalMs: pipeline.intervalMs,
  });
  // Games the last process left unfinished (cut off by a crash or a deploy) run now, not in a few seconds.
  matchPipeline.runDue();

  const keyRotation = dropOldNetworkKeysEveryMidnight({ networkKey, now });
  const flagRefresh = flagComponent.start();

  const close = async () => {
    keyRotation.stop();
    housekeeping.stop();
    botDriver.stop();
    await thinkingWorkers.close();
    await gateway.close();
    await tasks.drain();
    // The last counts go in before the database closes.
    await flagRefresh.stop();
    await database.close();
  };

  try {
    const { host, port } = await listen(server, { port: config.port, host: config.host });
    logger.info({ host, port, env: config.env }, "server listening");
    return { server, host, port, close };
  } catch (err) {
    keyRotation.stop();
    await flagRefresh.stop();
    botDriver.stop();
    await thinkingWorkers.close();
    await database.close();
    throw err;
  }
}

/**
 * Listens on the configured address only. Leaving the host out would make Node listen on every network
 * interface (CC-287).
 *
 * @param {http.Server} server
 * @param {{ port: number, host: string }} where
 * @returns {Promise<{ host: string, port: number }>} the address and port actually bound (the port matters when `port` is 0)
 */
function listen(server, { port, host }) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const bound = /** @type {import("node:net").AddressInfo} */ (server.address());
      resolve({ host: bound.address, port: bound.port });
    });
  });
}

/**
 * The one way out of the process for a handler: flush what is waiting, then exit. Telemetry sends log lines in a
 * batch once a minute, so a line written just before `exit` is lost unless it is flushed first. The flush gets
 * `withinMs` and no more, so an endpoint that never answers cannot keep a crashed process alive, and a failed
 * flush still exits. Only the first call exits. `started` tells a late caller that the way out has begun (CC-305).
 *
 * @param {{ flush: () => Promise<void>, proc: ProcessLike, withinMs: number }} options
 */
function exitAfterFlush({ flush, proc, withinMs }) {
  let started = false;
  return Object.freeze({
    started: () => started,
    /** @param {number} code */
    async exit(code) {
      if (started) return;
      started = true;
      let timer;
      // Not unref'd: after a crash nothing else may hold the process open, and it must still exit with its code.
      const limit = new Promise((resolve) => {
        timer = setTimeout(resolve, withinMs);
      });
      // A failed flush loses the last lines, which also stay in the platform's logs. Exiting matters more.
      await Promise.race([
        Promise.resolve()
          .then(flush)
          .catch(() => undefined),
        limit,
      ]);
      clearTimeout(timer);
      proc.exit(code);
    },
  });
}

/**
 * Closes the server on SIGINT/SIGTERM, forcing exit if open connections don't drain in time. Every way out writes
 * its last line, then flushes (CC-305), then exits.
 *
 * @param {{
 *   close: () => Promise<void>,
 *   flush: () => Promise<void>,
 *   logger: Logger,
 *   proc?: ProcessLike,
 *   timeoutMs?: number,
 *   flushWithinMs?: number,
 * }} options  `flush` sends what telemetry still holds. `proc`, `timeoutMs` and `flushWithinMs` are injectable so
 *   the behaviour can be unit tested without real signals.
 */
export function handleShutdownSignals({
  close,
  flush,
  logger,
  proc = process,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  flushWithinMs = FINAL_FLUSH_MS,
}) {
  assertFunction(close, "close");
  assertFunction(flush, "flush");
  const way = exitAfterFlush({ flush, proc, withinMs: flushWithinMs });
  const shutdown = async (signal) => {
    logger.info({ signal }, "shutting down");
    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, "shutdown timed out, forcing exit");
      way.exit(1);
    }, timeoutMs);
    forceExit.unref();
    let code = 1;
    try {
      await close();
      code = 0;
      // A close that ends after the timeout must not claim the shutdown completed: the process is already leaving.
      if (!way.started()) logger.info("shutdown complete");
    } catch (err) {
      if (!way.started()) logger.error({ err }, "error during shutdown");
    } finally {
      clearTimeout(forceExit);
    }
    await way.exit(code);
  };
  proc.once("SIGINT", shutdown);
  proc.once("SIGTERM", shutdown);
}

/**
 * A crash we did not anticipate leaves the process in an unknown state: log it as fatal, flush (CC-305) and exit,
 * so the platform restarts a clean instance.
 *
 * @param {{ flush: () => Promise<void>, logger: Logger, proc?: ProcessLike, flushWithinMs?: number }} options
 *   `flush` sends what telemetry still holds
 */
export function handleFatalErrors({ flush, logger, proc = process, flushWithinMs = FINAL_FLUSH_MS }) {
  assertFunction(flush, "flush");
  const way = exitAfterFlush({ flush, proc, withinMs: flushWithinMs });
  proc.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    way.exit(1);
  });
  proc.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    way.exit(1);
  });
}
