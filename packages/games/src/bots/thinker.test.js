import { describe, expect, it } from "vitest";
import { createSeededRng } from "../rng.js";
import { raceBot } from "../testing/raceBot.js";
import { BOTS } from "./bots.js";
import { CHESS_BOT_LEVELS } from "./chess/chessBot.js";
import { createBotRegistry } from "./registry.js";
import { createBotThinker } from "./thinker.js";

const thinker = createBotThinker(createBotRegistry(BOTS));
const chessTurn = (difficulty, seed = 7) => ({
  gameId: "chess",
  botId: "bot_queenvee_strong",
  difficulty,
  seed,
  view: { moves: ["e4", "e5", "Nf3"] },
});

describe("createBotThinker", () => {
  it("chooses what the bot chooses with a generator seeded from the turn's seed", () => {
    const request = chessTurn(CHESS_BOT_LEVELS.CLUB);
    const bot = createBotRegistry(BOTS).get("chess");

    expect(thinker.think(request)).toEqual(
      bot.chooseMove({
        view: request.view,
        botId: request.botId,
        rng: createSeededRng(request.seed),
        difficulty: request.difficulty,
        history: [],
      }),
    );
  });

  it("gives the same move for the same turn, every time", () => {
    expect(thinker.think(chessTurn(CHESS_BOT_LEVELS.BEGINNER, 3))).toEqual(
      thinker.think(chessTurn(CHESS_BOT_LEVELS.BEGINNER, 3)),
    );
  });

  it("answers the quickest move with the bot's easiest level for the same view and seed", () => {
    expect(thinker.quickest(chessTurn(CHESS_BOT_LEVELS.STRONG, 5))).toEqual(
      thinker.think(chessTurn(CHESS_BOT_LEVELS.BEGINNER, 5)),
    );
  });

  it("says which levels think hard: every chess level, and no other game's", () => {
    for (const bot of BOTS) {
      for (const level of bot.levels) {
        expect(thinker.isHeavy({ ...chessTurn(level.id), gameId: bot.gameId })).toBe(bot.gameId === "chess");
      }
    }
    expect(thinker.isHeavy(chessTurn("no-such-level"))).toBe(false);
  });

  it("refuses a seed outside 0 to 2^32 - 1, and a game without a bot", () => {
    for (const seed of [-1, 2 ** 32, 1.5, "7"]) {
      expect(() => thinker.think(chessTurn(CHESS_BOT_LEVELS.BEGINNER, seed))).toThrow(RangeError);
    }
    expect(() => thinker.think({ ...chessTurn(CHESS_BOT_LEVELS.BEGINNER), gameId: "ludo" })).toThrow(
      /No bot registered/,
    );
  });

  it("works for any bot in a registry, such as the test bot", () => {
    const race = createBotThinker(createBotRegistry([raceBot]));
    const request = { gameId: raceBot.gameId, botId: "b", difficulty: raceBot.levels[0].id, seed: 0 };

    expect(race.isHeavy(request)).toBe(false);
    expect(race.think({ ...request, view: { count: 0, target: 3 } })).toEqual(
      race.quickest({ ...request, view: { count: 0, target: 3 } }),
    );
  });
});
