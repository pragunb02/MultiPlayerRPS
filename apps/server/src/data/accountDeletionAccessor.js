import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} AccountDeletion   domain model (frozen, times in ms): an account that was deleted (CC-035)
 * @property {string} playerId
 * @property {number} requestedAt
 */

/**
 * Deletion records and closed legacy rows, for the domain (CC-035).
 *
 * @param {{ accountDeletionDao: ReturnType<typeof import("../persistence/accountDeletionDao.js").createAccountDeletionDao> }} deps
 */
export function createAccountDeletionAccessor({ accountDeletionDao }) {
  assertDefined(accountDeletionDao, "accountDeletionDao");

  return Object.freeze({
    /**
     * Records a deletion. A player recorded already keeps the first record.
     *
     * @param {{ playerId: string, requestedAt: number, sweepAgainAt: number, expiresAt: number }} deletion
     */
    record: ({ playerId, requestedAt, sweepAgainAt, expiresAt }) =>
      accountDeletionDao.insert({
        playerId,
        requestedAt: new Date(requestedAt),
        sweepAgainAt: new Date(sweepAgainAt),
        expiresAt: new Date(expiresAt),
      }),

    /**
     * @param {{ now: number, limit: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<AccountDeletion>>>} deletions whose second sweep is due
     */
    async listDue({ now, limit }) {
      const docs = await accountDeletionDao.listDue({ now: new Date(now), limit });
      return Object.freeze(
        docs.map(({ playerId, requestedAt }) =>
          Object.freeze({ playerId, requestedAt: requestedAt.getTime() }),
        ),
      );
    },

    /** @param {string} playerId */
    markSwept: (playerId) => accountDeletionDao.markSwept(playerId),

    /** @param {{ playerId: string, at: number }} next  when the deletion is swept once more */
    sweepAgainAt: ({ playerId, at }) => accountDeletionDao.sweepAgainAt({ playerId, at: new Date(at) }),

    /** @param {{ legacyId: string, at: number }} closure */
    closeLegacy: ({ legacyId, at }) => accountDeletionDao.closeLegacy({ legacyId, closedAt: new Date(at) }),

    /** @param {string} legacyId @returns {Promise<boolean>} */
    isLegacyClosed: (legacyId) => accountDeletionDao.isLegacyClosed(legacyId),
  });
}

/**
 * Stored sessions, by who they belong to (CC-035).
 *
 * @param {{ sessionDao: { deleteByPlayer: (playerId: string) => Promise<number> } }} deps
 */
export function createSessionAccessor({ sessionDao }) {
  assertDefined(sessionDao, "sessionDao");

  return Object.freeze({
    /** @param {string} playerId @returns {Promise<number>} sessions removed */
    removePlayer: (playerId) => sessionDao.deleteByPlayer(playerId),
  });
}
