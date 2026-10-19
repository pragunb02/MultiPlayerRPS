import { DuplicateKey, VersionConflict } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConcurrentChangeError, ConflictError } from "../utils/errors.js";

/**
 * @typedef {Readonly<{ rating: number, deviation: number, volatility: number }>} Glicko
 * @typedef {Readonly<{ matchId: string, at: number, before: Glicko, after: Glicko, superseded?: boolean }>} RatingChange
 *   one rated game. `superseded` marks a change of a rating that lost when a guest moved into an account (ADR-062)
 * @typedef {Readonly<{
 *   playerId: string,
 *   rating: number,
 *   deviation: number,
 *   volatility: number,
 *   games: number,
 *   lastRatedAt: number,
 *   seed?: Readonly<{ level: string, at: number }>,
 *   changes: ReadonlyArray<RatingChange>,
 *   mergedFrom: ReadonlyArray<string>,
 *   revision: number,
 * }>} ChessRating   domain model (frozen, times in ms). `playerId` is whose rating it is: the account, for a guest
 *   who moved into one. `lastRatedAt` is 0 before the first rated game. `revision` 0 means nothing is stored yet
 */

const START = Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 });
const glickoOf = ({ rating, deviation, volatility }) => Object.freeze({ rating, deviation, volatility });

/** @returns {ChessRating} */
function toRating({ playerId, revision, games, lastRatedAt, seed, changes, mergedFrom, ...doc }) {
  return Object.freeze({
    playerId,
    ...glickoOf(doc),
    games,
    lastRatedAt: lastRatedAt?.getTime() ?? 0,
    ...(seed && { seed: Object.freeze({ level: seed.level, at: seed.at.getTime() }) }),
    changes: Object.freeze(
      changes.map(({ matchId, at, before, after, superseded }) =>
        Object.freeze({
          matchId,
          at: at.getTime(),
          before: glickoOf(before),
          after: glickoOf(after),
          ...(superseded && { superseded }),
        }),
      ),
    ),
    mergedFrom: Object.freeze([...mergedFrom]),
    revision,
  });
}

function toFields(rating, at) {
  return {
    ...glickoOf(rating),
    games: rating.games,
    ...(rating.lastRatedAt > 0 && { lastRatedAt: new Date(rating.lastRatedAt) }),
    ...(rating.seed && { seed: { level: rating.seed.level, at: new Date(rating.seed.at) } }),
    changes: rating.changes.map(({ at: changedAt, ...change }) => ({ ...change, at: new Date(changedAt) })),
    mergedFrom: [...rating.mergedFrom],
    updatedAt: new Date(at),
  };
}

/**
 * Provides chess ratings to the domain (CC-042), hiding the storage format and the guest's marker.
 *
 * @param {{ chessRatingDao: ReturnType<typeof import("../persistence/chessRatingDao.js").createChessRatingDao> }} deps
 */
export function createChessRatingAccessor({ chessRatingDao }) {
  assertDefined(chessRatingDao, "chessRatingDao");

  /** The stored document, or none. */
  async function stored(playerId) {
    try {
      return [await chessRatingDao.getByPlayer(playerId)];
    } catch (err) {
      if (err instanceof RangeError) {
        return [];
      }
      throw err;
    }
  }

  const unrated = (playerId) =>
    Object.freeze({ playerId, ...START, games: 0, lastRatedAt: 0, changes: [], mergedFrom: [], revision: 0 });

  return Object.freeze({
    /**
     * A player's rating. A guest who moved into an account (ADR-014) gets the account's.
     *
     * @param {string} playerId
     * @returns {Promise<ChessRating>}
     */
    async get(playerId) {
      const [doc] = await stored(playerId);
      if (doc === undefined) {
        return unrated(playerId);
      }
      if (doc.mergedInto === undefined) {
        return toRating(doc);
      }
      const [account] = await stored(doc.mergedInto);
      return account === undefined ? unrated(doc.mergedInto) : toRating(account);
    },

    /**
     * Stores a rating, as long as nothing changed it since it was read at `rating.revision`.
     *
     * @param {{ rating: ChessRating, at: number }} save
     * @throws {ConcurrentChangeError} when another write came first, or the guest has moved to an account
     */
    async save({ rating, at }) {
      try {
        await chessRatingDao.write({
          playerId: rating.playerId,
          revision: rating.revision,
          doc: toFields(rating, at),
        });
      } catch (err) {
        if (err instanceof VersionConflict) {
          throw new ConcurrentChangeError("The chess rating changed meanwhile", { cause: err });
        }
        throw err;
      }
    },

    /**
     * Marks a guest's rating as moved to an account, and answers what it held.
     *
     * @param {{ from: string, to: string, at: number }} merge
     * @returns {Promise<ChessRating>} the guest's own rating (its `playerId` is the guest)
     * @throws {ConflictError} when the guest's rating already moved to another player
     */
    async markMerged({ from, to, at }) {
      try {
        return toRating(await chessRatingDao.markMergedInto({ from, to, at: new Date(at) }));
      } catch (err) {
        if (err instanceof DuplicateKey) {
          throw new ConflictError("This guest's chess rating already moved to another player", {
            cause: err,
          });
        }
        throw err;
      }
    },

    /**
     * Removes a player's rating and the markers of guests who moved into it (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<number>} documents removed
     */
    removePlayer: (playerId) => chessRatingDao.deleteByPlayer(playerId),
  });
}
