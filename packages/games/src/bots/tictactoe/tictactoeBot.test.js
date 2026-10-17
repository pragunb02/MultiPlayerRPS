import { describe, expect, it } from "vitest";
import { createSeededRng } from "../../rng.js";
import { describeBotContract } from "../../testing/botContract.js";
import { tictactoeEngine } from "../../tictactoe/tictactoeEngine.js";
import { TTT_BOT_LEVELS, tictactoeBot } from "./tictactoeBot.js";

const BOT = "bot";
const HUMAN = "human";
const CTX = { now: 0 };
const { EASY, MEDIUM, UNBEATABLE } = TTT_BOT_LEVELS;

describeBotContract(
  tictactoeBot,
  { engine: tictactoeEngine, options: {}, games: 60, maxMoves: 9, seed: 5, timeoutMs: 30_000 },
  { describe, it },
);

/** A new game where `starter` plays X. Seed 1 makes the second listed player start. */
const newGame = (starter) =>
  tictactoeEngine.init({
    players: starter === BOT ? [HUMAN, BOT] : [BOT, HUMAN],
    options: {},
    rng: createSeededRng(1),
  });

const play = (state, player, cell) =>
  tictactoeEngine.applyMove(
    state,
    player,
    tictactoeEngine.validateMove(state, player, { cell }, CTX).value,
    CTX,
  );

const botCell = (state, difficulty, rng) =>
  tictactoeBot.chooseMove({ view: tictactoeEngine.viewFor(state), botId: BOT, rng, difficulty, history: [] })
    .cell;

/** A position reached by playing `cells` in turn, starting with `starter`. */
function position(starter, cells) {
  return cells.reduce((state, cell) => play(state, state.turn, cell), newGame(starter));
}

const outcome = (state) => tictactoeEngine.getOutcome(state);

/** Plays a whole game between two levels, `first` playing X. Returns the winner's level or "draw". */
function match(first, second, seed) {
  const rng = createSeededRng(seed);
  const levels = { [BOT]: first, [HUMAN]: second };
  let state = newGame(BOT);
  expect(state.turn).toBe(BOT);
  while (outcome(state).status === "ongoing") {
    const player = state.turn;
    const { cell } = tictactoeBot.chooseMove({
      view: tictactoeEngine.viewFor(state),
      botId: player,
      rng,
      difficulty: levels[player],
      history: [],
    });
    state = play(state, player, cell);
  }
  const { winners } = outcome(state);
  return winners.length === 0 ? "draw" : winners[0];
}

const results = (first, second, games) =>
  Array.from({ length: games }, (_, seed) => match(first, second, seed)).reduce(
    (counts, result) => ({ ...counts, [result]: counts[result] + 1 }),
    { [BOT]: 0, [HUMAN]: 0, draw: 0 },
  );

/**
 * Rngs that make the bot pick each of its equally good options in turn: with k options, rng value
 * (i + 0.5) / 9 picks option floor((i + 0.5) * k / 9), and i from 0 to 8 reaches every option.
 */
const EVERY_TIE_BREAK = Array.from({ length: 9 }, (_, i) => () => (i + 0.5) / 9);

describe("tictactoeBot levels", () => {
  it("names its levels for players, easiest first", () => {
    expect(tictactoeBot.levels.map((level) => level.name)).toEqual(["Easy", "Medium", "Unbeatable"]);
  });

  it("refuses to choose on a full board", () => {
    const full = position(BOT, [0, 1, 2, 4, 3, 5, 7, 6, 8]);

    expect(() =>
      tictactoeBot.chooseMove({
        view: tictactoeEngine.viewFor(full),
        botId: BOT,
        rng: createSeededRng(1),
        difficulty: EASY,
        history: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("tictactoeBot Unbeatable", () => {
  /**
   * Walks every game the opponent could play. At the bot's turns it follows every move the bot might
   * pick among its equally good ones, so no seed can lead to a loss either.
   */
  function everyLine(state, counts) {
    const result = outcome(state);
    if (result.status === "finished") {
      counts[result.winners.length === 0 ? "draw" : result.winners[0]] += 1;
      return;
    }
    if (state.turn === BOT) {
      const choices = new Set(EVERY_TIE_BREAK.map((rng) => botCell(state, UNBEATABLE, rng)));
      choices.forEach((cell) => everyLine(play(state, BOT, cell), counts));
    } else {
      state.board.forEach((mark, cell) => mark === "" && everyLine(play(state, HUMAN, cell), counts));
    }
  }

  // Measured: when it starts, 10,640 lines end in 7,056 wins and 3,584 draws. When it replies, 6,112 lines
  // end in 2,528 wins and 3,584 draws.
  it.each([
    ["it starts", BOT, 10_640],
    ["the opponent starts", HUMAN, 6_112],
  ])(
    "never loses, over every line the opponent can play, when %s",
    (_, starter, lines) => {
      const counts = { [BOT]: 0, [HUMAN]: 0, draw: 0 };

      everyLine(newGame(starter), counts);

      expect(counts[HUMAN]).toBe(0);
      expect(counts[BOT] + counts.draw).toBe(lines);
    },
    30_000,
  );

  it("takes a win at once instead of a slower one", () => {
    // X (bot) on 0 and 1, O on 3 and 4: 2 wins now, and every other move would let O win at 5 or delay.
    expect(botCell(position(BOT, [0, 3, 1, 4]), UNBEATABLE, createSeededRng(1))).toBe(2);
  });

  it("blocks a line the opponent is about to complete", () => {
    expect(botCell(position(HUMAN, [0, 4, 1]), UNBEATABLE, createSeededRng(1))).toBe(2);
  });

  it("draws every game against itself", () => {
    expect(results(UNBEATABLE, UNBEATABLE, 50)).toEqual({ [BOT]: 0, [HUMAN]: 0, draw: 50 });
  });

  it("never loses to Easy or Medium and beats Easy most of the time", () => {
    const easy = results(UNBEATABLE, EASY, 300);
    const medium = results(MEDIUM, UNBEATABLE, 300);

    // Measured: 289 wins and 11 draws against Easy, 300 draws against Medium.
    expect(easy[HUMAN]).toBe(0);
    expect(easy[BOT]).toBeGreaterThan(250);
    expect(medium[BOT]).toBe(0);
  });
});

describe("tictactoeBot Medium", () => {
  it("takes a win when it has one", () => {
    expect(botCell(position(BOT, [0, 3, 1, 4]), MEDIUM, createSeededRng(1))).toBe(2);
  });

  it("blocks when it cannot win", () => {
    expect(botCell(position(HUMAN, [0, 4, 1]), MEDIUM, createSeededRng(1))).toBe(2);
  });

  it("takes the centre, then a corner", () => {
    expect(botCell(newGame(BOT), MEDIUM, createSeededRng(1))).toBe(4);
    expect([0, 2, 6, 8]).toContain(botCell(position(HUMAN, [4]), MEDIUM, createSeededRng(1)));
  });

  it("takes an edge once the centre and corners are gone and nothing is at stake", () => {
    // X (bot): 0, 2, 4, 7. O: 1, 3, 6, 8. Only the edge 5 is left and it neither wins nor blocks.
    const state = position(BOT, [0, 1, 2, 3, 4, 6, 7, 8]);

    expect(botCell(state, MEDIUM, createSeededRng(1))).toBe(5);
  });

  it("falls for a fork, which is what makes it beatable", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const rng = createSeededRng(seed);
      // Human (X) takes a corner, the bot the centre, the human the opposite corner.
      let state = play(newGame(HUMAN), HUMAN, 0);
      state = play(state, BOT, botCell(state, MEDIUM, rng));
      state = play(state, HUMAN, 8);
      state = play(state, BOT, botCell(state, MEDIUM, rng));
      // The bot took a corner, so it must block the line it opened up, then the human forks.
      const fork = state.board[2] === "O" ? 6 : 2;
      state = play(state, HUMAN, fork);
      state = play(state, BOT, botCell(state, MEDIUM, rng));
      const finish = state.board.findIndex(
        (mark, cell) => mark === "" && outcome(play(state, HUMAN, cell)).winners?.[0] === HUMAN,
      );

      expect(finish).toBeGreaterThan(-1);
    }
  });

  it("beats Easy far more often than it loses", () => {
    const counts = results(MEDIUM, EASY, 300);

    expect(counts[BOT]).toBeGreaterThan(5 * counts[HUMAN]);
  });
});

describe("tictactoeBot Easy", () => {
  it("only sometimes takes a win that is right there", () => {
    const state = position(BOT, [0, 3, 1, 4]);
    const picks = Array.from({ length: 200 }, (_, seed) => botCell(state, EASY, createSeededRng(seed)));
    const wins = picks.filter((cell) => cell === 2).length;

    expect(wins).toBeGreaterThan(80);
    expect(wins).toBeLessThan(180);
    expect(picks.every((cell) => state.board[cell] === "")).toBe(true);
  });

  it("plays anywhere when there is no win", () => {
    const cells = new Set(
      Array.from({ length: 200 }, (_, seed) => botCell(newGame(BOT), EASY, createSeededRng(seed))),
    );

    expect(cells.size).toBe(9);
  });
});
