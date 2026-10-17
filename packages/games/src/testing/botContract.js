import { GAME_STATUS } from "@classicade/shared";
import { createSeededRng } from "../rng.js";

/**
 * Shared contract checks every Bot must pass, the bot version of the engine contract kit. Every check
 * plays real games through the bot's engine, so "legal" always means "the engine accepted it".
 * Run them with `checkBotContract` (returns violations) or `describeBotContract` (one Vitest test each).
 *
 * @typedef {Object} BotScenario
 * @property {import("../engine.js").GameEngine<any, any, any>} engine   the engine the bot plays
 * @property {unknown} options                     raw game options that the engine accepts
 * @property {number | Record<string, number>} games
 *   games to play per level, as one number or per level id. Each level plays the easiest level, which
 *   for every bot here is mostly random, so these games also wander through many unusual positions.
 *   Every game after the first is a rematch, so bots also get earlier games as `history`.
 * @property {number} maxMoves                     a game longer than this counts as never finishing
 * @property {number} [seed]
 * @property {number} [replayMoves]                the determinism check compares only this many moves of
 *   each game, to keep slow bots (chess) quick to test. All moves by default.
 * @property {number} [timeoutMs]                  per check, for slow bots (chess)
 */

export class BotContractViolation extends Error {}

const SEATS = Object.freeze(["bot-one", "bot-two"]);
const CTX = Object.freeze({ now: 1_700_000_000_000 });

function assert(condition, message) {
  if (!condition) {
    throw new BotContractViolation(message);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** A move as a client sends it: a plain object of strings, numbers and booleans. */
const isPlainMove = (raw) =>
  raw !== null &&
  typeof raw === "object" &&
  Object.getPrototypeOf(raw) === Object.prototype &&
  Object.values(raw).every((value) => ["string", "number", "boolean"].includes(typeof value));

const gamesFor = (scenario, level) =>
  typeof scenario.games === "number" ? scenario.games : (scenario.games[level] ?? 0);

/**
 * Plays one game between two levels and returns every move made and the final views. Views and
 * history are frozen, so a bot that changes what it is shown fails loudly.
 */
function playGame(bot, scenario, { levels, seed, history, stopAfter }) {
  const { engine } = scenario;
  const rng = createSeededRng(seed);
  const options = engine.validateOptions(scenario.options);
  assert(options.ok, `the engine rejected the scenario's options: ${options.message}`);
  let state = engine.init({ players: [...SEATS], options: options.value, rng });
  const moves = [];
  while (engine.getOutcome(state).status === GAME_STATUS.ONGOING && moves.length < stopAfter) {
    assert(moves.length < scenario.maxMoves, `the game did not finish within ${scenario.maxMoves} moves`);
    for (const seat of engine.activePlayers(state)) {
      const turn = {
        view: deepFreeze(structuredClone(engine.viewFor(state, seat))),
        botId: seat,
        rng,
        difficulty: levels[seat],
        history: deepFreeze(history[seat]),
      };
      let raw;
      try {
        raw = bot.chooseMove(turn);
      } catch (err) {
        throw new BotContractViolation(`${levels[seat]} threw on move ${moves.length + 1}: ${err.message}`);
      }
      assert(isPlainMove(raw), `${levels[seat]} returned ${String(raw)}, not a plain move object`);
      const validated = engine.validateMove(state, seat, raw, CTX);
      assert(
        validated.ok,
        `${levels[seat]} played an illegal move ${JSON.stringify(raw)} (${validated.reason}: ${validated.message})`,
      );
      state = engine.applyMove(state, seat, validated.value, CTX);
      moves.push(raw);
    }
  }
  const finalViews = Object.fromEntries(
    SEATS.map((seat) => [seat, structuredClone(engine.viewFor(state, seat))]),
  );
  return { moves, finalViews };
}

/**
 * A rematch series: `count` games in a row between `level` and the easiest level, swapping seats each
 * game, each bot seeing its final views of the earlier games as history.
 */
function playSeries(bot, scenario, { level, count, seed, stopAfter = Infinity }) {
  const easiest = bot.levels[0].id;
  const history = Object.fromEntries(SEATS.map((seat) => [seat, []]));
  const games = [];
  for (let index = 0; index < count; index += 1) {
    const [first, second] = index % 2 === 0 ? [level, easiest] : [easiest, level];
    const game = playGame(bot, scenario, {
      levels: { [SEATS[0]]: first, [SEATS[1]]: second },
      seed: seed + index,
      stopAfter,
      history: Object.fromEntries(SEATS.map((seat) => [seat, [...history[seat]]])),
    });
    SEATS.forEach((seat) => history[seat].push(game.finalViews[seat]));
    games.push(game.moves);
  }
  return games;
}

const CHECKS = Object.freeze([
  {
    name: "belongs to its engine and names its levels for players",
    run(bot, scenario) {
      assert(
        bot.gameId === scenario.engine.id,
        `bot is for "${bot.gameId}", engine is "${scenario.engine.id}"`,
      );
      assert(Array.isArray(bot.levels) && bot.levels.length > 0, "a bot needs at least one level");
      for (const level of bot.levels) {
        assert(typeof level.name === "string" && level.name.length > 0, `level "${level.id}" has no name`);
        assert(
          typeof level.description === "string" && level.description.length > 0,
          `level "${level.id}" has no description`,
        );
      }
      assert(new Set(bot.levels.map((level) => level.id)).size === bot.levels.length, "level ids repeat");
    },
  },
  {
    name: "refuses a difficulty it does not have",
    run(bot, scenario) {
      const options = scenario.engine.validateOptions(scenario.options);
      const state = scenario.engine.init({
        players: [...SEATS],
        options: options.value,
        rng: createSeededRng(1),
      });
      const [seat] = scenario.engine.activePlayers(state);
      let threw = false;
      try {
        bot.chooseMove({
          view: scenario.engine.viewFor(state, seat),
          botId: seat,
          rng: createSeededRng(1),
          difficulty: "no-such-level",
          history: [],
        });
      } catch (err) {
        threw = err instanceof RangeError;
      }
      assert(threw, "an unknown difficulty must throw a RangeError, not quietly play some other level");
    },
  },
  {
    name: "plays only legal moves, never throws and finishes every game, at every level",
    run(bot, scenario) {
      bot.levels.forEach(({ id }, index) => {
        playSeries(bot, scenario, {
          level: id,
          count: gamesFor(scenario, id),
          seed: (scenario.seed ?? 1) + 1000 * index,
        });
      });
    },
  },
  {
    name: "makes the same moves from the same seed",
    run(bot, scenario) {
      bot.levels.forEach(({ id }, index) => {
        const series = {
          level: id,
          count: Math.min(2, gamesFor(scenario, id)),
          seed: 77 + index,
          stopAfter: scenario.replayMoves ?? Infinity,
        };
        const first = JSON.stringify(playSeries(bot, scenario, series));
        assert(first === JSON.stringify(playSeries(bot, scenario, series)), `${id} is not deterministic`);
      });
    },
  },
]);

export const BOT_CONTRACT_CHECK_NAMES = Object.freeze(CHECKS.map((check) => check.name));

/**
 * Runs every check and collects violations instead of stopping at the first.
 *
 * @param {import("../bots/bot.js").Bot} bot
 * @param {BotScenario} scenario
 * @returns {Array<{ check: string, message: string }>}
 */
export function checkBotContract(bot, scenario) {
  const violations = [];
  for (const { name, run } of CHECKS) {
    try {
      run(bot, scenario);
    } catch (err) {
      violations.push({ check: name, message: err.message });
    }
  }
  return violations;
}

/**
 * Registers one test per check, for use inside a bot's test file.
 *
 * @param {import("../bots/bot.js").Bot} bot
 * @param {BotScenario} scenario
 * @param {{ describe: Function, it: Function }} vitest  pass `{ describe, it }` from "vitest"
 */
export function describeBotContract(bot, scenario, { describe, it }) {
  describe(`${bot.gameId} bot contract`, () => {
    for (const { name, run } of CHECKS) {
      it(name, () => run(bot, scenario), scenario.timeoutMs);
    }
  });
}
