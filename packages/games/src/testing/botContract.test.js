import { describe, expect, it } from "vitest";
import { defineBot } from "../bots/bot.js";
import { BOT_CONTRACT_CHECK_NAMES, checkBotContract, describeBotContract } from "./botContract.js";
import { raceBot } from "./raceBot.js";
import { raceEngine } from "./raceEngine.js";

const scenario = { engine: raceEngine, options: { target: 10 }, games: 6, maxMoves: 20, seed: 3 };

// The reference bot must pass every check, exactly how real bots use the kit.
describeBotContract(raceBot, scenario, { describe, it });

/** A copy of the reference bot with one behaviour broken. */
const broken = (overrides) => defineBot({ ...raceBot, ...overrides });
const violatedChecks = (bot, overrides = {}) =>
  checkBotContract(bot, { ...scenario, ...overrides }).map((violation) => violation.check);
const [NAMES, UNKNOWN_LEVEL, PLAYS, DETERMINISTIC] = BOT_CONTRACT_CHECK_NAMES;

describe("checkBotContract catches broken bots", () => {
  it("reports nothing for a correct bot", () => {
    expect(checkBotContract(raceBot, scenario)).toEqual([]);
  });

  it("catches a bot that plays an illegal move", () => {
    const cheat = broken({ chooseMove: () => ({ add: 3 }) });

    expect(violatedChecks(cheat)).toContain(PLAYS);
  });

  it("catches a bot that throws", () => {
    const fragile = broken({
      chooseMove() {
        throw new Error("boom");
      },
    });

    expect(checkBotContract(fragile, scenario)).toContainEqual({
      check: PLAYS,
      message: "lucky threw on move 1: boom",
    });
  });

  it("catches a bot that answers with something other than a plain move", () => {
    for (const answer of [undefined, null, 2, new Map(), { add: () => 1 }]) {
      const odd = broken({ chooseMove: () => answer });

      expect(violatedChecks(odd)).toContain(PLAYS);
    }
  });

  it("catches a bot that changes the view it is shown", () => {
    const meddling = broken({
      chooseMove(turn) {
        turn.view.count = 0;
        return raceBot.chooseMove(turn);
      },
    });

    expect(violatedChecks(meddling)).toContain(PLAYS);
  });

  it("catches a bot that changes its history", () => {
    const meddling = broken({
      chooseMove(turn) {
        turn.history.push({});
        return raceBot.chooseMove(turn);
      },
    });

    expect(violatedChecks(meddling)).toContain(PLAYS);
  });

  it("catches games that do not finish in time", () => {
    expect(violatedChecks(raceBot, { maxMoves: 3 })).toContain(PLAYS);
  });

  it("catches a bot whose moves do not follow from the seed", () => {
    let calls = 0;
    const moody = broken({
      chooseMove(turn) {
        calls += 1;
        // Depends on how often it was called before, a pattern that never lines up with a game's length.
        return { add: Math.min(turn.view.target - turn.view.count, 1 + (Math.floor(Math.sqrt(calls)) % 2)) };
      },
    });

    expect(violatedChecks(moody)).toEqual([DETERMINISTIC]);
  });

  it("catches a bot that plays some other level for an unknown difficulty", () => {
    const lax = { ...raceBot, chooseMove: (turn) => raceBot.chooseMove({ ...turn, difficulty: "lucky" }) };

    expect(violatedChecks(lax)).toEqual([UNKNOWN_LEVEL]);
  });

  it("catches a bot that throws the wrong error for an unknown difficulty", () => {
    const vague = {
      ...raceBot,
      chooseMove(turn) {
        if (turn.difficulty === "no-such-level") {
          throw new Error("no");
        }
        return raceBot.chooseMove(turn);
      },
    };

    expect(violatedChecks(vague)).toEqual([UNKNOWN_LEVEL]);
  });

  it("catches a bot for another game, or with levels players cannot read", () => {
    const cases = [
      { ...raceBot, gameId: "chess" },
      { ...raceBot, levels: [] },
      { ...raceBot, levels: [{ id: "a", name: "", description: "x" }] },
      { ...raceBot, levels: [{ id: "a", name: "A", description: "" }] },
      { ...raceBot, levels: [...raceBot.levels, raceBot.levels[0]] },
    ];

    for (const bot of cases) {
      expect(violatedChecks(bot)).toContain(NAMES);
    }
  });

  it("catches a scenario whose options the engine refuses", () => {
    expect(violatedChecks(raceBot, { options: { target: 1 } })).toContain(PLAYS);
  });

  it("compares only the first moves of each game when asked to, for slow bots", () => {
    let calls = 0;
    // Always opens with 1, after that depends on how often it was called before.
    const moody = broken({
      chooseMove({ view }) {
        calls += 1;
        const left = view.target - view.count;
        return { add: view.count === 0 ? 1 : Math.min(left, 1 + (Math.floor(Math.sqrt(calls)) % 2)) };
      },
    });

    expect(violatedChecks(moody, { replayMoves: 1 })).toEqual([]);
    expect(violatedChecks(moody)).toEqual([DETERMINISTIC]);
  });

  it("plays only the games asked for each level", () => {
    let careful = 0;
    const counting = broken({
      chooseMove(turn) {
        careful += turn.difficulty === "careful" ? 1 : 0;
        return raceBot.chooseMove(turn);
      },
    });

    checkBotContract(counting, { ...scenario, games: { lucky: 1 } });

    expect(careful).toBe(0);
  });
});
