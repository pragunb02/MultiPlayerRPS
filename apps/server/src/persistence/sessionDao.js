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

    /**
     * Notes friend request rings that a tab of this browser heard (CC-341), and drops those that rang at or before
     * `since` in the same write. They sit beside the session, in `heardRings`, not in it: the store saves a session
     * with `$set` of its own fields only, so an answer that saves the session keeps them, and nothing here ever
     * writes the session itself, which a socket holds only as it was at its handshake (CC-326). A session that
     * ended is never written again: the update matches an existing session only.
     *
     * @param {{ sessionId: string, rings: ReadonlyArray<{ requestId: string, ringAt: number }>, since: number }} heard
     */
    async addHeardRings({ sessionId, rings, since }) {
      const added = rings.map(({ requestId, ringAt }) => ({ requestId, ringAt }));
      await sessions().updateOne({ _id: sessionId }, [
        {
          $set: {
            heardRings: {
              $concatArrays: [
                {
                  $filter: {
                    input: { $ifNull: ["$heardRings", []] },
                    cond: { $gt: ["$$this.ringAt", since] },
                  },
                },
                { $literal: added },
              ],
            },
          },
        },
      ]);
    },

    /**
     * @param {{ sessionId: string, since: number }} query
     * @returns {Promise<Array<{ requestId: string, ringAt: number }>>} the rings heard that rang after `since`
     */
    async heardRings({ sessionId, since }) {
      const found = await sessions().findOne({ _id: sessionId }, { projection: { heardRings: 1 } });
      return (found?.heardRings ?? [])
        .filter((ring) => ring.ringAt > since)
        .map(({ requestId, ringAt }) => ({ requestId, ringAt }));
    },
  });
}
