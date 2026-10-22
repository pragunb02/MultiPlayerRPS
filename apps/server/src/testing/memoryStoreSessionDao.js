import { storedDevice } from "../persistence/sessionDao.js";

/**
 * Test double with the same contract as `createSessionDao`, over express-session's memory store, which the
 * in-process test app uses (verified by the shared contract tests).
 *
 * @param {{ store: import("express-session").MemoryStore }} deps
 */
export function createMemoryStoreSessionDao({ store }) {
  const all = () =>
    new Promise((resolve, reject) =>
      store.all((err, sessions) => (err ? reject(err) : resolve(sessions ?? {}))),
    );
  const destroy = (sid) =>
    new Promise((resolve, reject) => store.destroy(sid, (err) => (err ? reject(err) : resolve())));
  const idsOf = async (playerId) => {
    const sessions = await all();
    return { sessions, ids: Object.keys(sessions).filter((sid) => sessions[sid].identity?.id === playerId) };
  };

  return Object.freeze({
    async deleteByPlayer(playerId) {
      const { ids } = await idsOf(playerId);
      await Promise.all(ids.map(destroy));
      return ids.length;
    },

    async listByPlayer(playerId) {
      const { sessions, ids } = await idsOf(playerId);
      // The memory store moves the cookie's expiry on every request, as the MongoDB store moves its own.
      return Object.freeze(
        ids
          .filter((sid) => sessions[sid].device?.id !== undefined)
          .map((sid) =>
            storedDevice({ sessionId: sid, session: sessions[sid], expires: sessions[sid].cookie.expires }),
          ),
      );
    },

    async deleteSession({ sessionId, playerId }) {
      const { ids } = await idsOf(playerId);
      if (!ids.includes(sessionId)) return false;
      await destroy(sessionId);
      return true;
    },
  });
}
