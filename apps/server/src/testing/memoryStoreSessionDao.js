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

  const exists = (sid) =>
    new Promise((resolve, reject) =>
      store.get(sid, (err, data) => (err ? reject(err) : resolve(Boolean(data)))),
    );
  // Beside the sessions, as the MongoDB DAO keeps them beside each session document. Gone with their session.
  /** @type {Map<string, Array<{ requestId: string, ringAt: number }>>} */
  const heard = new Map();

  return Object.freeze({
    async deleteByPlayer(playerId) {
      const sessions = await all();
      const ids = Object.keys(sessions).filter((sid) => sessions[sid].identity?.id === playerId);
      await Promise.all(ids.map(destroy));
      return ids.length;
    },
    async addHeardRings({ sessionId, rings, since }) {
      if (!(await exists(sessionId))) {
        heard.delete(sessionId);
        return;
      }
      const kept = (heard.get(sessionId) ?? []).filter((ring) => ring.ringAt > since);
      heard.set(sessionId, [...kept, ...rings.map(({ requestId, ringAt }) => ({ requestId, ringAt }))]);
    },
    async heardRings({ sessionId, since }) {
      if (!(await exists(sessionId))) return [];
      return (heard.get(sessionId) ?? []).filter((ring) => ring.ringAt > since);
    },
  });
}
