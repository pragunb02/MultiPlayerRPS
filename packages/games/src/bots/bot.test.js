import { describe, expect, it } from "vitest";
import { createSeededRng } from "../rng.js";
import { raceBot } from "../testing/raceBot.js";
import { defineBot } from "./bot.js";

const valid = {
  gameId: "race",
  levels: [{ id: "only", name: "Only", description: "The one level." }],
  chooseMove: () => ({ add: 1 }),
};
const turn = (difficulty) => ({
  view: { count: 0, target: 3 },
  botId: "bot",
  rng: createSeededRng(1),
  difficulty,
  history: [],
});

describe("defineBot", () => {
  it("returns a frozen bot with frozen levels", () => {
    const bot = defineBot(valid);

    expect(Object.isFrozen(bot)).toBe(true);
    expect(Object.isFrozen(bot.levels)).toBe(true);
    expect(Object.isFrozen(bot.levels[0])).toBe(true);
    expect(bot.levels).toEqual(valid.levels);
  });

  it("passes a turn at a known level to the strategy", () => {
    expect(defineBot(valid).chooseMove(turn("only"))).toEqual({ add: 1 });
  });

  it("answers nothing when the bot has no questions to answer", () => {
    expect(defineBot(valid).answer({ view: {}, botId: "bot" })).toEqual([]);
  });

  it("passes a question to the bot's own answer, as a frozen list", () => {
    const bot = defineBot({ ...valid, answer: ({ botId }) => [{ reply: botId }] });

    const answers = bot.answer({ view: {}, botId: "bot" });

    expect(answers).toEqual([{ reply: "bot" }]);
    expect(Object.isFrozen(answers)).toBe(true);
  });

  it("refuses a difficulty the bot does not have", () => {
    expect(() => raceBot.chooseMove(turn("expert"))).toThrow(/Unknown race bot difficulty "expert"/);
  });

  it.each([
    [{ ...valid, gameId: "" }, /gameId must be/],
    [{ ...valid, gameId: undefined }, /gameId must be/],
    [{ ...valid, levels: [] }, /levels must be a non-empty array/],
    [{ ...valid, levels: "easy" }, /levels must be a non-empty array/],
    [{ ...valid, levels: [{ id: "Easy Mode", name: "Easy", description: "x" }] }, /needs a lowercase id/],
    [{ ...valid, levels: [null] }, /needs a lowercase id/],
    [{ ...valid, levels: [{ id: "easy", name: "", description: "x" }] }, /needs a lowercase id and a name/],
    [{ ...valid, levels: [{ id: "easy", name: "Easy" }] }, /level "easy" needs a description/],
    [{ ...valid, levels: [{ id: "easy", name: "Easy", description: "" }] }, /needs a description/],
    [{ ...valid, levels: [valid.levels[0], valid.levels[0]] }, /level ids must be unique/],
    [{ ...valid, chooseMove: "nope" }, /chooseMove must be a function/],
    [{ ...valid, answer: "nope" }, /answer, when given, must be a function/],
    [undefined, /Invalid bot for "undefined"/],
  ])("rejects a malformed bot (%#)", (bot, message) => {
    expect(() => defineBot(bot)).toThrow(message);
  });
});
