/**
 * Thinking workers for tests that run every think on the event loop, at once, with the same pure function the
 * worker threads use. Integration tests stay fast and deterministic, and `botThinkingClient.test.js` covers the
 * threads themselves.
 *
 * @param {ReturnType<typeof import("@classicade/games").createBotThinker>} thinker
 * @param {{ size?: number }} [options]
 * @returns {Readonly<import("../domain/bots/thinkingQueue.js").ThinkingWorkers>}
 */
export function inProcessThinking(thinker, { size = 1 } = {}) {
  return Object.freeze({
    size,
    async run(request) {
      try {
        return { ok: true, move: thinker.think(request) };
      } catch (error) {
        return { ok: false, reason: "failed", error };
      }
    },
  });
}
