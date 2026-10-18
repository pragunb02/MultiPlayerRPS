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
 * @property {Readonly<MatchCredit>} [credit]   how the match counts, once judged (CC-095). Matches recorded before
 *   then have none and count for everyone
 *
 * @typedef {{ notCounted: ReadonlyArray<Readonly<{ playerId: string, reason: string, withdrawnFrom?: string }>>, botXp?: ReadonlyArray<Readonly<{ playerId: string, xp: number, left: number, withdrawnFrom?: string, withdrawnXp?: number }>> }} MatchCredit
 *   the players the match does not count for, and why (a NOT_COUNTED_REASONS value). `withdrawnFrom` names the
 *   guest it counted for before the guest's games moved to this player. `botXp` is there in a game against a
 *   computer character: the XP it gave each person within the day's limit, and what was left of it (ADR-025). A
 *   guest's such game that gave more than the account had left keeps the part taken away in `withdrawnXp`
 *
 * @typedef {Readonly<{ matchId: string, players: ReadonlyArray<{ playerId: string }>, endedAt: number, credit?: Readonly<MatchCredit> }>} CountedGame
 *   the little the fair play limits need to know about another game of a player, with its verdict once judged
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

  /** Reads one match, turning "no such match" into NotFoundError. */
  async function found(read) {
    try {
      return toMatch(await read());
    } catch (err) {
      if (err instanceof RangeError) {
        throw new NotFoundError("Match not found", { cause: err });
      }
      throw err;
    }
  }

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
    getById: (matchId) => found(() => matchDao.getByMatchId(matchId)),

    /**
     * Stores how a match counts, unless it was judged already.
     *
     * @param {{ matchId: string, credit: MatchCredit }} verdict
     * @returns {Promise<Readonly<Match>>} the match as stored now, with the first verdict it got
     * @throws {NotFoundError}
     */
    judgeOnce: ({ matchId, credit }) => found(() => matchDao.judgeOnce({ matchId, credit })),

    /**
     * A player's games that count for them (or are not judged yet) and ended in `[from, to)`, without one match.
     *
     * @param {{ playerId: string, from: number, to: number, excluding: string }} window  times in ms
     * @returns {Promise<ReadonlyArray<CountedGame>>} oldest first
     */
    async listCountedBetween({ playerId, from, to, excluding }) {
      const docs = await matchDao.listCountedBetween(playerId, {
        from: new Date(from),
        to: new Date(to),
        excluding,
      });
      return deepFreeze(docs.map(({ endedAt, ...game }) => ({ ...game, endedAt: endedAt.getTime() })));
    },

    /**
     * The games of `playerId` that counted for guest `from`, but stopped counting when they moved to `playerId`.
     *
     * @param {{ playerId: string, from: string }} query
     * @returns {Promise<ReadonlyArray<Readonly<Match>>>} oldest first
     */
    async listWithdrawn({ playerId, from }) {
      return Object.freeze((await matchDao.listWithdrawn({ playerId, from })).map(toMatch));
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

    /**
     * Deletes a match only while `playerId` still plays in it (CC-035).
     *
     * @param {{ matchId: string, playerId: string }} which
     * @returns {Promise<boolean>} whether it was deleted now
     */
    deleteForPlayer: (which) => matchDao.deleteForPlayer(which),
  });
}
