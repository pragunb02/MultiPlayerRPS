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

  return Object.freeze({
    async deleteByPlayer(playerId) {
      const sessions = await all();
      const ids = Object.keys(sessions).filter((sid) => sessions[sid].identity?.id === playerId);
      await Promise.all(ids.map(destroy));
      return ids.length;
    },
  });
}
