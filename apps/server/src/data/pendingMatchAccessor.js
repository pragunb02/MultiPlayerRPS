import { assertDefined } from "../utils/assert.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} PendingMatch          domain model (deeply frozen, times in ms): a finished game in the match
 *   pipeline's outbox (CC-111)
 * @property {string} matchId
 * @property {Readonly<import("./matchAccessor.js").Match>} match   the match to record
 * @property {"pending" | "done" | "failed"} status
 * @property {ReadonlyArray<string>} done   the pipeline steps already done
 * @property {number} attempts             failed attempts so far
 * @property {number} nextAttemptAt
 * @property {Readonly<{ step: string, message: string }>} [lastError]
 * @property {number} createdAt
 */

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** @returns {Readonly<PendingMatch>} */
const toPendingMatch = ({ matchId, match, status, done, attempts, nextAttemptAt, lastError, createdAt }) =>
  deepFreeze({
    matchId,
    match,
    status,
    done,
    attempts,
    nextAttemptAt: nextAttemptAt.getTime(),
    ...(lastError !== undefined && { lastError }),
    createdAt: createdAt.getTime(),
  });

/**
 * Provides the match pipeline's outbox to the domain, hiding how it is stored (Dates, the TTL field).
 *
 * @param {{ pendingMatchDao: ReturnType<typeof import("../persistence/pendingMatchDao.js").createPendingMatchDao> }} deps
 */
export function createPendingMatchAccessor({ pendingMatchDao }) {
  assertDefined(pendingMatchDao, "pendingMatchDao");

  return Object.freeze({
    /**
     * Adds a finished game, due at once. A game added before stays as it is, whatever happened to it since.
     *
     * @param {{ match: Readonly<import("./matchAccessor.js").Match>, at: number }} add
     * @returns {Promise<boolean>} whether it was added now
     */
    add: ({ match, at }) =>
      pendingMatchDao.insertIfAbsent({
        matchId: match.matchId,
        match,
        createdAt: new Date(at),
        nextAttemptAt: new Date(at),
      }),

    /**
     * @param {string} matchId
     * @returns {Promise<Readonly<PendingMatch>>}
     * @throws {NotFoundError} when the outbox has no such game
     */
    async get(matchId) {
      try {
        return toPendingMatch(await pendingMatchDao.get(matchId));
      } catch (err) {
        if (err instanceof RangeError) {
          throw new NotFoundError("No such game in the match pipeline", { cause: err });
        }
        throw err;
      }
    },

    /**
     * @param {{ now: number, limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<PendingMatch>>>} pending games due at `now`, the longest waiting first
     */
    async listDue({ now, limit }) {
      const docs = await pendingMatchDao.listDue({ now: new Date(now), limit });
      return Object.freeze(docs.map(toPendingMatch));
    },

    /** @param {{ matchId: string, step: string }} done */
    stepDone: (done) => pendingMatchDao.addDone(done),

    /**
     * Records a failed attempt: the game waits until `nextAttemptAt`, or with `failed` it is never tried again.
     *
     * @param {{ matchId: string, failed: boolean, attempts: number, nextAttemptAt: number, lastError: { step: string, message: string } }} failure
     */
    attemptFailed: ({ matchId, failed, attempts, nextAttemptAt, lastError }) =>
      pendingMatchDao.recordFailure({
        matchId,
        status: failed ? "failed" : "pending",
        attempts,
        nextAttemptAt: new Date(nextAttemptAt),
        lastError,
      }),

    /**
     * Every step is done. The record is kept until `keepUntil`, so the same game is not run again meanwhile.
     *
     * @param {{ matchId: string, at: number, keepUntil: number }} done
     */
    done: ({ matchId, at, keepUntil }) =>
      pendingMatchDao.markDone({ matchId, doneAt: new Date(at), expiresAt: new Date(keepUntil) }),
  });
}
