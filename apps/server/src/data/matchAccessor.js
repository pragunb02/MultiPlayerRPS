import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} Match              domain model of a finished game (deeply frozen; times in ms)
 * @property {string} matchId
 * @property {string} roomCode
 * @property {string} gameId
 * @property {Readonly<Record<string, unknown>>} options
 * @property {number} seed
 * @property {ReadonlyArray<Readonly<{ playerId: string, displayName: string }>>} players
 * @property {ReadonlyArray<Readonly<import("./roomAccessor.js").LogEntry>>} log
 * @property {Readonly<{ result: string, winners: string[], reason: string }>} result
 * @property {number} startedAt
 * @property {number} endedAt
 */

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** @returns {Readonly<Match>} */
const toMatch = ({ schemaVersion, startedAt, endedAt, ...doc }) =>
  deepFreeze({ ...doc, startedAt: startedAt.getTime(), endedAt: endedAt.getTime() });

const toDoc = (match) => ({
  ...match,
  startedAt: new Date(match.startedAt),
  endedAt: new Date(match.endedAt),
});

/**
 * Provides finished matches to the domain, hiding the storage format (Dates, schema versions).
 *
 * @param {{ matchDao: ReturnType<typeof import("../persistence/matchDao.js").createMatchDao> }} deps
 */
export function createMatchAccessor({ matchDao }) {
  assertDefined(matchDao, "matchDao");

  return Object.freeze({
    /**
     * Records a match. Idempotent: recording the same match again returns the stored one.
     *
     * @param {Match} match
     * @returns {Promise<Readonly<Match>>}
     */
    async record(match) {
      try {
        return toMatch(await matchDao.insert(toDoc(match)));
      } catch (err) {
        if (err instanceof DuplicateKey) {
          return toMatch(await matchDao.getByMatchId(match.matchId));
        }
        throw err;
      }
    },

    /**
     * @param {string} matchId
     * @returns {Promise<Readonly<Match>>}
     * @throws {NotFoundError}
     */
    async getById(matchId) {
      try {
        return toMatch(await matchDao.getByMatchId(matchId));
      } catch (err) {
        if (err instanceof RangeError) {
          throw new NotFoundError("Match not found", { cause: err });
        }
        throw err;
      }
    },

    /**
     * @param {string} playerId
     * @param {{ limit: number, before?: number }} page  `before` is an endedAt in ms (exclusive)
     * @returns {Promise<ReadonlyArray<Readonly<Match>>>}
     */
    /**
     * @param {{ playerId: string, gameId: string }} query
     * @returns {Promise<number>} matches of that game the player won
     */
    countWins: ({ playerId, gameId }) => matchDao.countWins({ playerId, gameId }),

    async listForPlayer(playerId, { limit, before }) {
      const docs = await matchDao.listByPlayer(playerId, {
        limit,
        ...(before !== undefined && { before: new Date(before) }),
      });
      return Object.freeze(docs.map(toMatch));
    },

    /**
     * Every match `playerId` played that `excluding` did not, oldest first.
     *
     * @param {string} playerId
     * @param {{ excluding: string }} filter
     * @returns {Promise<ReadonlyArray<Readonly<Match>>>}
     */
    async listExcluding(playerId, { excluding }) {
      return Object.freeze((await matchDao.listByPlayerExcluding(playerId, { excluding })).map(toMatch));
    },

    /**
     * Stores a match's renamed copy, only while `from` still plays in the stored one.
     *
     * @param {{ from: string, match: Match }} rename
     * @returns {Promise<boolean>} whether it was renamed now
     */
    replaceRenamed({ from, match }) {
      return matchDao.renamePlayer({ matchId: match.matchId, from, doc: toDoc(match) });
    },
  });
}
