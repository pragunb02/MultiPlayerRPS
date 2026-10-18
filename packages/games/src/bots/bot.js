/**
 * The contract every bot implements. A bot is a computer player for one game. The server will seat it
 * like a person: it sees what that seat may see, answers with a move shaped exactly like a client's,
 * and the engine validates that move like any other. So a buggy bot can never break the rules.
 *
 * Rules for implementations (checked by the bot contract kit in `@classicade/games/testing`):
 * 1. Pure: the same turn and the same RNG sequence always give the same move. No Math.random, no clock.
 * 2. Fair: decides only from `view`, which is `engine.viewFor(state, botId)`. The full state is never
 *    passed in, because in some games (Rock Paper Scissors) it holds the opponent's secret choice.
 * 3. Never mutates its input, and only gets called when the engine lists the bot as an active player.
 *
 * @typedef {Object} BotLevel
 * @property {string} id            stable id used by the API and the database, never shown
 * @property {string} name          what players see on the difficulty picker, such as "Unbeatable"
 * @property {string} description   one short sentence for players about how this level plays
 *
 * @typedef {Object} BotTurn
 * @property {unknown} view                     what the bot's seat may see right now
 * @property {string} botId                     the bot's player id in this game
 * @property {import("../rng.js").Rng} rng      the only source of randomness
 * @property {string} difficulty                one of the bot's level ids
 * @property {ReadonlyArray<unknown>} history   the bot's final views of earlier games against the same
 *   opponent in this room (rematches), oldest first. Empty for the first game.
 *
 * @typedef {Object} BotQuestion
 * @property {unknown} view       what the bot's seat may see right now
 * @property {string} botId       the bot's player id in this game
 * @property {ReadonlyArray<{ type: string, from: string }>} requests   the room's open requests addressed to the
 *   bot (CC-159), such as a chess draw offer
 *
 * @typedef {Object} Bot
 * @property {string} gameId                        matches the engine's id
 * @property {ReadonlyArray<Readonly<BotLevel>>} levels   easiest first
 * @property {(turn: BotTurn) => unknown} chooseMove   returns a raw move, as a client would send it
 * @property {(question: BotQuestion) => ReadonlyArray<{ type: string, answer: string }>} [answer]   optional.
 *   Called when it is not the bot's turn, so a question the other player asked (a chess draw offer) never waits
 *   for the bot. Returns the answer to each request it answers, as the request type and a REQUEST_ANSWERS value,
 *   or an empty list when there is nothing to answer.
 */

const LEVEL_ID = /^[a-z][a-z0-9-]*$/;
const NOTHING_TO_ANSWER = () => [];

/**
 * Checks a bot against the contract's shape and freezes it, so a malformed bot fails at import time.
 * The returned `chooseMove` refuses unknown difficulty ids, because quietly playing some other level
 * would hide a wiring mistake.
 *
 * @param {Bot} bot
 * @returns {Readonly<Bot>}
 */
export function defineBot(bot) {
  const problems = [];
  if (typeof bot?.gameId !== "string" || bot.gameId === "") {
    problems.push("gameId must be a game id");
  }
  const levels = Array.isArray(bot?.levels) ? bot.levels : [];
  if (levels.length === 0) {
    problems.push("levels must be a non-empty array");
  }
  for (const level of levels) {
    if (
      typeof level?.id !== "string" ||
      !LEVEL_ID.test(level.id) ||
      typeof level.name !== "string" ||
      level.name === ""
    ) {
      problems.push(`level ${JSON.stringify(level?.id)} needs a lowercase id and a name`);
    } else if (typeof level.description !== "string" || level.description === "") {
      problems.push(`level "${level.id}" needs a description`);
    }
  }
  const ids = levels.map((level) => level?.id);
  if (new Set(ids).size !== ids.length) {
    problems.push("level ids must be unique");
  }
  if (typeof bot?.chooseMove !== "function") {
    problems.push("chooseMove must be a function");
  }
  if (bot?.answer !== undefined && typeof bot.answer !== "function") {
    problems.push("answer, when given, must be a function");
  }
  if (problems.length > 0) {
    throw new TypeError(`Invalid bot for "${bot?.gameId}": ${problems.join(", ")}`);
  }
  const known = new Set(ids);
  const choose = bot.chooseMove;
  const answer = bot.answer ?? NOTHING_TO_ANSWER;
  return Object.freeze({
    gameId: bot.gameId,
    levels: Object.freeze(levels.map((level) => Object.freeze({ ...level }))),
    chooseMove(turn) {
      if (!known.has(turn.difficulty)) {
        throw new RangeError(`Unknown ${bot.gameId} bot difficulty "${turn.difficulty}"`);
      }
      return choose(turn);
    },
    // A bot without questions to answer still has `answer`, so the server never has to ask which kind it is.
    answer: (question) => Object.freeze([...answer(question)]),
  });
}
