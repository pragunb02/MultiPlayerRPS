import { assertDefined } from "../utils/assert.js";

/**
 * Provides players' privacy switches to the domain (CC-052, ADR-066). A player who never set a switch has the
 * default, and nothing is stored for them. CC-278 adds the other switches here.
 *
 * @param {{ privacyDao: ReturnType<typeof import("../persistence/privacyDao.js").createPrivacyDao> }} deps
 */
export function createPrivacyAccessor({ privacyDao }) {
  assertDefined(privacyDao, "privacyDao");

  return Object.freeze({
    /**
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<ReadonlySet<string>>} those among them who chose to appear offline
     */
    async appearingOffline(playerIds) {
      if (playerIds.length === 0) return new Set();
      const docs = await privacyDao.findByPlayers(playerIds);
      return new Set(docs.filter((doc) => doc.appearOffline).map((doc) => doc.playerId));
    },

    /**
     * @param {{ playerId: string, appearOffline: boolean, at: number }} change
     * @returns {Promise<void>}
     */
    async setAppearOffline({ playerId, appearOffline, at }) {
      await privacyDao.set({ playerId, appearOffline, updatedAt: new Date(at) });
    },

    /** @param {string} playerId @returns {Promise<number>} documents removed */
    remove: (playerId) => privacyDao.deleteByPlayer(playerId),
  });
}
