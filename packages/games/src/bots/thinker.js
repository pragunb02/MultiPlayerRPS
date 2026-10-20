import { createSeededRng } from "../rng.js";
import { BOT_LEVEL_COSTS } from "./bot.js";

/**
 * One computer player's turn as plain data, so it can be sent to a worker thread and back unchanged (ADR-067).
 * It holds only what the bot may know: its own seat's view (ADR-040), its id and level, and the seed of its only
 * source of randomness.
 *
 * @typedef {Object} ThinkRequest
 * @property {string} gameId       the bot's game, which picks the strategy
 * @property {string} botId        the bot's player id in this game
 * @property {string} difficulty   one of the bot's level ids
 * @property {number} seed         a whole number from 0 to 4294967295, the seed of the turn's random numbers
 * @property {unknown} view        `engine.viewFor(state, botId)`
 */

const MAX_SEED = 2 ** 32 - 1;

/**
 * Chooses computer moves from turns given as plain data. The server calls it on its event loop for light levels,
 * and a worker thread calls the same function for heavy ones, so the same request always gives the same move
 * wherever it runs.
 *
 * @param {ReturnType<typeof import("./registry.js").createBotRegistry>} bots
 */
export function createBotThinker(bots) {
  const botFor = (request) => {
    if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > MAX_SEED) {
      throw new RangeError("A turn's seed must be a whole number from 0 to 2^32 - 1");
    }
    return bots.get(request.gameId);
  };
  const play = (request, difficulty) =>
    botFor(request).chooseMove({
      view: request.view,
      botId: request.botId,
      rng: createSeededRng(request.seed),
      difficulty,
      history: [],
    });

  return Object.freeze({
    /**
     * The move the bot chooses for this turn.
     *
     * @param {Readonly<ThinkRequest>} request
     * @returns {unknown} a raw move, as a client would send it
     */
    think: (request) => play(request, request.difficulty),

    /**
     * The move the bot's easiest level chooses for the same turn: the quick answer when the real thinking ran out
     * of time or its thread failed. Bots list their levels easiest first, and the easiest is always cheap.
     *
     * @param {Readonly<ThinkRequest>} request
     */
    quickest: (request) => play(request, botFor(request).levels[0].id),

    /**
     * Whether the request's level thinks hard enough to run off the event loop.
     *
     * @param {Readonly<ThinkRequest>} request
     */
    isHeavy: (request) =>
      botFor(request).levels.find((level) => level.id === request.difficulty)?.cost === BOT_LEVEL_COSTS.HEAVY,
  });
}
