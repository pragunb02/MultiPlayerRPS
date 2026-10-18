import { SESSION_COLLECTION } from "./sessionStore.js";

/**
 * Deletes stored sessions by who they belong to, which the session store itself cannot do. The store keeps each
 * session as an object (`stringify: false`), so the identity can be matched in the database.
 *
 * @param {{ client: import("mongodb").MongoClient }} deps
 */
export function createSessionDao({ client }) {
  const sessions = () => client.db().collection(SESSION_COLLECTION);

  return Object.freeze({
    /**
     * Deletes every session of one player, on every browser (CC-035). There is no index on the identity: this runs
     * only when an account is deleted, and the collection holds at most 30 days of sessions.
     *
     * @param {string} playerId
     * @returns {Promise<number>} sessions removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await sessions().deleteMany({ "session.identity.id": playerId });
      return deletedCount;
    },
  });
}
