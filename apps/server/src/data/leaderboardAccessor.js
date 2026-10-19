import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} LeaderboardEntry   domain model (frozen; times in ms)
 * @property {string} playerId
 * @property {string} displayName
 * @property {number} level
 * @property {number} score
 * @property {number} updatedAt          when the score last changed: on a tie, earlier ranks higher
 *
 * @typedef {{ board: string, period: string }} BoardRef   storage board ("xp", "wins:<gameId>") and period
 * @typedef {BoardRef & { playerId: string, displayName: string, level: number, at: number, expiresAt?: number }} EntryWrite
 */

const toEntry = ({ updatedAt, ...doc }) => Object.freeze({ ...doc, updatedAt: updatedAt.getTime() });
/**
 * @typedef {{ period: string, score: number, updatedAt: number, recentKeys: ReadonlyArray<string>, expiresAt?: number }} KeyedRow
 *   one row of a player with the match and quest keys it counted, and when it ends if it does (times in ms)
 */
const toKeyedRow = ({ updatedAt, recentKeys, expiresAt, ...row }) =>
  Object.freeze({
    ...row,
    updatedAt: updatedAt.getTime(),
    recentKeys: Object.freeze([...recentKeys]),
    ...(expiresAt !== undefined && { expiresAt: expiresAt.getTime() }),
  });
const toWrite = ({ at, expiresAt, ...write }) => ({
  ...write,
  at: new Date(at),
  ...(expiresAt !== undefined && { expiresAt: new Date(expiresAt) }),
});

/**
 * Provides leaderboard entries to the domain, hiding how they are stored.
 *
 * @param {{ leaderboardDao: ReturnType<typeof import("../persistence/leaderboardDao.js").createLeaderboardDao> }} deps
 */
export function createLeaderboardAccessor({ leaderboardDao }) {
  assertDefined(leaderboardDao, "leaderboardDao");

  return Object.freeze({
    /**
     * Raises an entry's score to `score` if it is higher (idempotent for totals such as XP or win counts).
     *
     * @param {EntryWrite & { score: number }} write
     * @returns {Promise<{ raised: boolean }>}
     */
    raiseScore: (write) => leaderboardDao.raiseScore(toWrite(write)),

    /**
     * Adds to an entry's score once per key (a match id, a quest key).
     *
     * @param {EntryWrite & { key: string, inc: number }} write
     * @returns {Promise<{ applied: boolean }>}
     */
    addOnce: (write) => leaderboardDao.addOnce(toWrite(write)),

    /**
     * Adds to an entry's score once per key, and remembers `keys` too: the keys a guest's row counted, so none of
     * them is added to the account again (CC-291).
     *
     * @param {EntryWrite & { key: string, keys: ReadonlyArray<string>, inc: number }} write
     * @returns {Promise<{ applied: boolean }>}
     */
    mergeOnce: ({ keys, ...write }) => leaderboardDao.mergeOnce({ ...toWrite(write), keys: [...keys] }),

    /**
     * One player's rows of one board, every period, with the keys they counted and when they end (CC-291).
     *
     * @param {{ board: string, playerId: string }} query
     * @returns {Promise<ReadonlyArray<Readonly<KeyedRow>>>}
     */
    async listWithKeys(query) {
      return Object.freeze((await leaderboardDao.listWithKeys(query)).map(toKeyedRow));
    },

    /**
     * Moves the end of one player's rows of a period later, never earlier (CC-291).
     *
     * @param {{ playerId: string, period: string, expiresAt: number }} change
     * @returns {Promise<number>} rows changed
     */
    extendLifetime: ({ expiresAt, ...change }) =>
      leaderboardDao.extendLifetime({ ...change, expiresAt: new Date(expiresAt) }),

    /**
     * @param {BoardRef & { limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<LeaderboardEntry>>>} best first
     */
    async listTop(query) {
      return Object.freeze((await leaderboardDao.top(query)).map(toEntry));
    },

    /**
     * A player's rank (1 = best) and score on a board.
     *
     * @param {BoardRef & { playerId: string }} query
     * @returns {Promise<Readonly<{ rank: number, score: number }>>}
     * @throws {NotFoundError} when the player is not on the board
     */
    async getStanding({ board, period, playerId }) {
      let entry;
      try {
        entry = await leaderboardDao.getEntry({ board, period, playerId });
      } catch (err) {
        if (err instanceof RangeError) {
          throw new NotFoundError("Not on this leaderboard", { cause: err });
        }
        throw err;
      }
      const ahead = await leaderboardDao.countAhead({ board, period, ...entry });
      return Object.freeze({ rank: ahead + 1, score: entry.score });
    },

    /**
     * Every entry of one player, on every board and period, for their data export (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<Readonly<LeaderboardEntry & BoardRef>>>}
     */
    async listForPlayer(playerId) {
      return Object.freeze((await leaderboardDao.listByPlayer(playerId)).map(toEntry));
    },

    /** @param {string} playerId @returns {Promise<number>} entries removed (CC-035) */
    removePlayer: (playerId) => leaderboardDao.deleteByPlayer(playerId),
  });
}
