import { DAILY_PUZZLE_REFUSALS } from "@classicade/shared";
import { DuplicateKey, VersionConflict } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConflictError } from "../utils/errors.js";

/**
 * @typedef {Object} DailyPuzzleAttempt  domain model (frozen, times in ms): one player's go at one day's puzzle
 * @property {string} playerId
 * @property {string} kind
 * @property {string} day
 * @property {string} puzzleId
 * @property {"playing" | "solved" | "failed"} status
 * @property {ReadonlyArray<string>} found   the player's accepted moves, oldest first
 * @property {ReadonlyArray<number>} marks   mistakes made at each move to find
 * @property {number} mistakes
 * @property {ReadonlyArray<number>} hints   hints taken at each move to find
 * @property {number} streak                 the kind's streak once the day ended, 0 before
 * @property {number} best
 * @property {number} version
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} finishedAt             0 while it is being played
 */

const deepFreeze = (value) => {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** @returns {Readonly<DailyPuzzleAttempt>} */
function toAttempt({ startedAt, updatedAt, finishedAt, ...doc }) {
  return deepFreeze({
    ...doc,
    found: [...doc.found],
    marks: [...doc.marks],
    hints: [...doc.hints],
    startedAt: startedAt.getTime(),
    updatedAt: updatedAt.getTime(),
    finishedAt: finishedAt === undefined ? 0 : finishedAt.getTime(),
  });
}

const toDoc = ({ startedAt, updatedAt, finishedAt, ...attempt }) => ({
  ...attempt,
  found: [...attempt.found],
  marks: [...attempt.marks],
  hints: [...attempt.hints],
  startedAt: new Date(startedAt),
  updatedAt: new Date(updatedAt),
  ...(finishedAt > 0 && { finishedAt: new Date(finishedAt) }),
});

const keyOf = ({ playerId, kind, day }) => ({ playerId, kind, day });

/**
 * Provides the daily puzzles and the players' attempts at them to the domain (CC-144, ADR-061).
 *
 * @param {{
 *   attemptDao: ReturnType<typeof import("../persistence/dailyPuzzleAttemptDao.js").createDailyPuzzleAttemptDao>,
 *   catalogues: Readonly<Record<string, ReadonlyArray<object>>>,  each kind's puzzles, in the order the days use them
 * }} deps
 */
export function createDailyPuzzleAccessor({ attemptDao, catalogues }) {
  assertDefined(attemptDao, "attemptDao");
  assertDefined(catalogues, "catalogues");
  const puzzles = deepFreeze(structuredClone(catalogues));

  return Object.freeze({
    /**
     * @param {string} kind
     * @returns {ReadonlyArray<object>} the kind's puzzles in the order the days use them
     * @throws {RangeError} for a kind without a catalogue
     */
    puzzlesOf(kind) {
      if (!Object.hasOwn(puzzles, kind)) {
        throw new RangeError(`No puzzles of the kind ${kind}`);
      }
      return puzzles[kind];
    },

    /**
     * Stores a new attempt, or answers the one the player already has that day.
     *
     * @param {Readonly<DailyPuzzleAttempt>} attempt
     * @returns {Promise<Readonly<DailyPuzzleAttempt>>}
     */
    async start(attempt) {
      try {
        await attemptDao.insert(toDoc(attempt));
        return toAttempt(toDoc(attempt));
      } catch (err) {
        if (!(err instanceof DuplicateKey)) throw err;
        const [existing] = await attemptDao.findDay(keyOf(attempt));
        return toAttempt(existing);
      }
    },

    /**
     * @param {{ playerId: string, kind: string, day: string }} key
     * @returns {Promise<ReadonlyArray<Readonly<DailyPuzzleAttempt>>>} the attempt, or nothing
     */
    findDay: async (key) => Object.freeze((await attemptDao.findDay(key)).map(toAttempt)),

    /**
     * @param {{ playerId: string, kind: string, beforeDay: string }} query
     * @returns {Promise<ReadonlyArray<Readonly<DailyPuzzleAttempt>>>} the latest ended attempt before the day, or nothing
     */
    findLatestFinished: async (query) =>
      Object.freeze((await attemptDao.findLatestFinished(query)).map(toAttempt)),

    /**
     * Saves a changed attempt, if nobody changed it since `attempt.version` was read.
     *
     * @param {Readonly<DailyPuzzleAttempt>} attempt  the attempt as it should be stored, with the version it was read at
     * @returns {Promise<Readonly<DailyPuzzleAttempt>>}
     * @throws {ConflictError} when it changed in between, for example in another tab
     */
    async save(attempt) {
      const { playerId, kind, day, version, ...changes } = toDoc(attempt);
      try {
        return toAttempt(await attemptDao.update({ playerId, kind, day, version }, changes));
      } catch (err) {
        if (!(err instanceof VersionConflict)) throw err;
        throw new ConflictError("The puzzle changed in another tab", {
          cause: err,
          details: { reason: DAILY_PUZZLE_REFUSALS.CHANGED },
        });
      }
    },

    /** @param {string} playerId @returns {Promise<ReadonlyArray<Readonly<DailyPuzzleAttempt>>>} by kind, oldest first */
    listByPlayer: async (playerId) => Object.freeze((await attemptDao.listByPlayer(playerId)).map(toAttempt)),

    /** @param {{ from: string, to: string, kind: string, day: string }} move @returns {Promise<number>} */
    reassign: (move) => attemptDao.reassign(move),

    /** @param {{ playerId: string, kind: string, day: string }} key @returns {Promise<number>} */
    removeDay: (key) => attemptDao.deleteDay(keyOf(key)),

    /** @param {string} playerId @returns {Promise<number>} attempts removed */
    removePlayer: (playerId) => attemptDao.deleteByPlayer(playerId),
  });
}
