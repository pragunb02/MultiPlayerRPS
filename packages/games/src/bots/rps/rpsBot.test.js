import { describe, expect, it } from "vitest";
import { createSeededRng } from "../../rng.js";
import { rpsEngine } from "../../rps/rpsEngine.js";
import { describeBotContract } from "../../testing/botContract.js";
import { RPS_BOT_LEVELS, rpsBot } from "./rpsBot.js";

const BOT = "bot";
const HUMAN = "human";
const CTX = { now: 0 };

describeBotContract(
  rpsBot,
  { engine: rpsEngine, options: { bestOf: 5 }, games: 40, maxMoves: 400, seed: 11, timeoutMs: 30_000 },
  { describe, it },
);

/**
 * Plays one match between the bot and a scripted opponent, who chooses from the number of rounds played.
 * Returns the final state and the bot's final view (for rematches).
 */
function playMatch({ difficulty, opponent, seed, bestOf = 5, history = [] }) {
  const rng = createSeededRng(seed);
  let state = rpsEngine.init({ players: [BOT, HUMAN], options: { bestOf }, rng });
  while (state.winner === "") {
    const view = rpsEngine.viewFor(state, BOT);
    const botMove = rpsBot.chooseMove({ view, botId: BOT, rng, difficulty, history });
    state = rpsEngine.applyMove(state, BOT, rpsEngine.validateMove(state, BOT, botMove, CTX).value, CTX);
    const humanMove = { choice: opponent(state.rounds.length) };
    state = rpsEngine.applyMove(
      state,
      HUMAN,
      rpsEngine.validateMove(state, HUMAN, humanMove, CTX).value,
      CTX,
    );
  }
  return { state, finalView: rpsEngine.viewFor(state, BOT) };
}

const winsOver = (matches, options) =>
  Array.from({ length: matches }, (_, seed) => playMatch({ ...options, seed })).filter(
    ({ state }) => state.winner === BOT,
  ).length;

const firstChoice = ({ difficulty, history, seed }) => {
  const state = rpsEngine.init({ players: [BOT, HUMAN], options: { bestOf: 3 }, rng: createSeededRng(seed) });
  return rpsBot.chooseMove({
    view: rpsEngine.viewFor(state, BOT),
    botId: BOT,
    rng: createSeededRng(seed),
    difficulty,
    history,
  }).choice;
};

const tally = (choices) =>
  choices.reduce((counts, choice) => ({ ...counts, [choice]: (counts[choice] ?? 0) + 1 }), {});

describe("rpsBot levels", () => {
  it("names its levels for players, simplest first", () => {
    expect(rpsBot.levels.map((level) => level.name)).toEqual(["Random", "Pattern reader"]);
  });
});

describe("rpsBot Random", () => {
  it("picks each choice about equally often", () => {
    const counts = tally(
      Array.from({ length: 900 }, (_, seed) =>
        firstChoice({ difficulty: RPS_BOT_LEVELS.RANDOM, history: [], seed }),
      ),
    );

    for (const choice of ["rock", "paper", "scissors"]) {
      expect(counts[choice]).toBeGreaterThan(250);
    }
  });

  it("wins only about half the matches against someone who always plays rock, like a coin toss", () => {
    const wins = winsOver(200, { difficulty: RPS_BOT_LEVELS.RANDOM, opponent: () => "rock" });

    // Measured: 100 of 200 best-of-5 matches with these seeds.
    expect(wins).toBeGreaterThan(70);
    expect(wins).toBeLessThan(130);
  });
});

describe("rpsBot Pattern reader", () => {
  it("plays at random before it has seen a single round", () => {
    const counts = tally(
      Array.from({ length: 300 }, (_, seed) =>
        firstChoice({ difficulty: RPS_BOT_LEVELS.PATTERN, history: [], seed }),
      ),
    );

    expect(Object.keys(counts).sort()).toEqual(["paper", "rock", "scissors"]);
  });

  it("beats someone who always plays rock in almost every match", () => {
    // Measured: 198 of 200 best-of-5 matches with these seeds.
    expect(
      winsOver(200, { difficulty: RPS_BOT_LEVELS.PATTERN, opponent: () => "rock" }),
    ).toBeGreaterThanOrEqual(190);
  });

  it("learns a cycle (rock, paper, scissors, again) and beats it most of the time", () => {
    const cycle = ["rock", "paper", "scissors"];
    const wins = winsOver(200, { difficulty: RPS_BOT_LEVELS.PATTERN, opponent: (round) => cycle[round % 3] });

    // Measured: 176 of 200. The Random level wins 100.
    expect(wins).toBeGreaterThanOrEqual(150);
  });

  it("still surprises: against all rock it does not always throw paper", () => {
    const { state } = playMatch({
      difficulty: RPS_BOT_LEVELS.PATTERN,
      opponent: () => "rock",
      seed: 1,
      bestOf: 9,
    });
    const many = Array.from({ length: 50 }, (_, seed) =>
      playMatch({ difficulty: RPS_BOT_LEVELS.PATTERN, opponent: () => "rock", seed, bestOf: 9 }),
    ).flatMap(({ state: played }) => played.rounds.slice(1).map((round) => round.choices[BOT]));

    expect(state.winner).toBe(BOT);
    expect(many.filter((choice) => choice !== "paper").length).toBeGreaterThan(many.length * 0.05);
  });

  it("remembers earlier games in a rematch and opens against the habit it saw", () => {
    const { finalView } = playMatch({
      difficulty: RPS_BOT_LEVELS.PATTERN,
      opponent: () => "scissors",
      seed: 3,
    });
    const openings = tally(
      Array.from({ length: 200 }, (_, seed) =>
        firstChoice({ difficulty: RPS_BOT_LEVELS.PATTERN, history: [finalView], seed }),
      ),
    );

    expect(openings.rock).toBeGreaterThan(150);
  });

  it("chooses the same whether or not the opponent has already chosen, because it never sees that choice", () => {
    const rngFor = () => createSeededRng(5);
    let state = rpsEngine.init({ players: [BOT, HUMAN], options: { bestOf: 3 }, rng: rngFor() });
    const before = rpsEngine.viewFor(state, BOT);
    state = rpsEngine.applyMove(state, HUMAN, { choice: "paper" }, CTX);
    const after = rpsEngine.viewFor(state, BOT);
    const choose = (view) =>
      rpsBot.chooseMove({ view, botId: BOT, rng: rngFor(), difficulty: RPS_BOT_LEVELS.PATTERN, history: [] });

    expect(JSON.stringify(after)).not.toContain('"paper"');
    expect(choose(after)).toEqual(choose(before));
  });
});
