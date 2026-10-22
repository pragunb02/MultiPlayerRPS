import { assertDefined } from "../utils/assert.js";

/**
 * @typedef {Object} SignedInDevice   domain model (frozen, times in ms): one stored session of an account (CC-262)
 * @property {string} sessionId       never leaves the server
 * @property {number} sessionVersion  the account's session version it was made at (CC-116)
 * @property {number} signedInAt
 * @property {number} lastSeenAt      up to an hour behind
 * @property {string} deviceId        random, the only name the browser ever gets for it
 * @property {string} browser
 * @property {string} system
 */

/**
 * Stored sessions, by who they belong to (CC-035, CC-262).
 *
 * @param {{ sessionDao: Partial<ReturnType<typeof import("../persistence/sessionDao.js").createSessionDao>> }} deps
 */
export function createSessionAccessor({ sessionDao }) {
  assertDefined(sessionDao, "sessionDao");

  return Object.freeze({
    /** @param {string} playerId @returns {Promise<number>} sessions removed */
    removePlayer: (playerId) => sessionDao.deleteByPlayer(playerId),

    /**
     * Every stored session of the player that has a device.
     *
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<Readonly<SignedInDevice>>>}
     */
    async devicesOf(playerId) {
      const stored = await sessionDao.listByPlayer(playerId);
      return Object.freeze(
        stored.map(({ sessionId, sessionVersion, signedInAt, lastSeenAt, device }) =>
          Object.freeze({
            sessionId,
            sessionVersion,
            signedInAt,
            lastSeenAt,
            deviceId: device.id,
            browser: device.browser,
            system: device.system,
          }),
        ),
      );
    },

    /**
     * Deletes one session of the player.
     *
     * @param {{ sessionId: string, playerId: string }} which
     * @returns {Promise<boolean>} whether there was such a session
     */
    removeSession: ({ sessionId, playerId }) => sessionDao.deleteSession({ sessionId, playerId }),
  });
}
