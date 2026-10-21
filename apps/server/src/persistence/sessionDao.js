import { SESSION_COLLECTION } from "./sessionStore.js";

/**
 * @typedef {Object} StoredDevice   persistence object: one stored session of an account that has its device (CC-262)
 * @property {string} sessionId
 * @property {number} sessionVersion
 * @property {number} signedInAt     ms
 * @property {number} lastSeenAt     ms, when the store last wrote the session (at most an hour behind, CC-096)
 * @property {{ id: string, browser: string, system: string }} device
 */

/**
 * When a stored session was last written. Every write moves its expiry to that moment plus the cookie's lifetime.
 * The store rewrites an unchanged session at most once an hour, so this can be up to an hour behind.
 */
const lastSeenOf = (expires, cookie) => new Date(expires).getTime() - cookie.originalMaxAge;

/** The persistence object of a stored session, in the shape both session DAOs return. */
export const storedDevice = ({ sessionId, session, expires }) =>
  Object.freeze({
    sessionId,
    sessionVersion: session.sessionVersion ?? 0,
    signedInAt: session.signedInAt,
    lastSeenAt: lastSeenOf(expires, session.cookie),
    device: Object.freeze({ ...session.device }),
  });

/**
 * Reads and deletes stored sessions by who they belong to, which the session store itself cannot do. The store keeps
 * each session as an object (`stringify: false`), so the identity can be matched in the database.
 *
 * @param {{ client: import("mongodb").MongoClient }} deps
 */
export function createSessionDao({ client }) {
  const sessions = () => client.db().collection(SESSION_COLLECTION);

  return Object.freeze({
    /** The devices list reads a player's sessions on every profile visit, so they are found by an index (CC-262). */
    async ensureIndexes() {
      await sessions().createIndex({ "session.identity.id": 1 });
    },

    /**
     * Deletes every session of one player, on every browser (CC-035).
     *
     * @param {string} playerId
     * @returns {Promise<number>} sessions removed
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await sessions().deleteMany({ "session.identity.id": playerId });
      return deletedCount;
    },

    /**
     * The stored sessions of one player that have a device (CC-262). A session signed in before devices existed
     * gets one on its next request, and is left out until then.
     *
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<StoredDevice>>}
     */
    async listByPlayer(playerId) {
      const docs = await sessions()
        .find(
          { "session.identity.id": playerId, "session.device.id": { $exists: true } },
          {
            projection: {
              expires: 1,
              "session.sessionVersion": 1,
              "session.signedInAt": 1,
              "session.cookie.originalMaxAge": 1,
              "session.device": 1,
            },
          },
        )
        .toArray();
      return Object.freeze(
        docs.map((doc) => storedDevice({ sessionId: doc._id, session: doc.session, expires: doc.expires })),
      );
    },

    /**
     * Deletes one session, only when it belongs to the player (CC-262).
     *
     * @param {{ sessionId: string, playerId: string }} which
     * @returns {Promise<boolean>} whether there was such a session
     */
    async deleteSession({ sessionId, playerId }) {
      const { deletedCount } = await sessions().deleteOne({
        _id: sessionId,
        "session.identity.id": playerId,
      });
      return deletedCount === 1;
    },
  });
}
