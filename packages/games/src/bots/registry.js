/**
 * Looks bots up by game id. Like the engine registry this is the plug in point: the room code that will
 * seat bots only asks the registry, so a new bot needs no changes anywhere else.
 *
 * @param {ReadonlyArray<Readonly<import("./bot.js").Bot>>} bots
 */
export function createBotRegistry(bots) {
  const byGame = new Map();
  for (const bot of bots) {
    if (byGame.has(bot.gameId)) {
      throw new TypeError(`Duplicate bot for game "${bot.gameId}"`);
    }
    byGame.set(bot.gameId, bot);
  }

  return Object.freeze({
    /** @param {string} gameId */
    has: (gameId) => byGame.has(gameId),
    /**
     * @param {string} gameId  must have a bot, so check `has` first
     */
    get(gameId) {
      const bot = byGame.get(gameId);
      if (bot === undefined) {
        throw new RangeError(`No bot registered for "${gameId}"`);
      }
      return bot;
    },
    gameIds: () => Object.freeze([...byGame.keys()]),
  });
}
