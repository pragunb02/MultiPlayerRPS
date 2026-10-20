import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import { createSeededRng } from "../../packages/games/src/rng.js";
import { GAME_IDS, RPS_CHOICES } from "../../packages/shared/src/index.js";
import { chooseMove, DEFAULT_MODEL, draw, pickPlan, roomOptions } from "./model.mjs";

/** An RNG that answers the given numbers in turn, so a test picks every branch on purpose. */
const sequence = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe("draw", () => {
  it("stays within the span, both ends included", () => {
    const rng = createSeededRng(1);
    const values = Array.from({ length: 500 }, () => draw(rng, { min: 2, max: 4 }));

    expect(new Set(values)).toEqual(new Set([2, 3, 4]));
  });
});

describe("pickPlan", () => {
  it("picks a game by its share and a game between people above the computer share", () => {
    expect(pickPlan(sequence(0.1, 0.99), DEFAULT_MODEL)).toEqual({
      gameId: GAME_IDS.RPS,
      computer: false,
      level: "",
    });
    expect(pickPlan(sequence(0.5, 0.99), DEFAULT_MODEL).gameId).toBe(GAME_IDS.TIC_TAC_TOE);
    expect(pickPlan(sequence(0.95, 0.99), DEFAULT_MODEL).gameId).toBe(GAME_IDS.CHESS);
  });

  it("gives the last game whatever the shares leave when they add up to a little under 1", () => {
    const model = { ...DEFAULT_MODEL, gameShare: { [GAME_IDS.RPS]: 0.5, [GAME_IDS.CHESS]: 0.4999 } };

    expect(pickPlan(sequence(0.99995, 0.99), model).gameId).toBe(GAME_IDS.CHESS);
  });

  it("starts a computer game with one of the character's levels", () => {
    expect(pickPlan(sequence(0.95, 0.1, 0.99), DEFAULT_MODEL)).toEqual({
      gameId: GAME_IDS.CHESS,
      computer: true,
      level: "hard",
    });
  });

  it("seats the computer share of players in computer games", () => {
    const rng = createSeededRng(7);
    let solo = 0;
    let people = 0;
    for (let i = 0; i < 20_000; i += 1) {
      if (pickPlan(rng, DEFAULT_MODEL).computer) solo += 1;
      else people += 2;
    }

    expect(solo / (solo + people)).toBeCloseTo(DEFAULT_MODEL.computerShare, 1);
  });
});

describe("roomOptions", () => {
  it("opens Rock Paper Scissors with its best of, chess with its clock and Tic-Tac-Toe plainly", () => {
    expect(roomOptions(GAME_IDS.RPS, DEFAULT_MODEL)).toEqual({ bestOf: 3 });
    expect(roomOptions(GAME_IDS.CHESS, DEFAULT_MODEL)).toEqual({ timeControl: "blitz-5+0" });
    expect(roomOptions(GAME_IDS.TIC_TAC_TOE, DEFAULT_MODEL)).toEqual({});
  });
});

describe("chooseMove", () => {
  const rng = createSeededRng(3);

  it("throws one of the three choices", () => {
    const { choice } = chooseMove({ gameId: GAME_IDS.RPS, game: { view: {} }, rng, resign: false });

    expect(Object.values(RPS_CHOICES)).toContain(choice);
  });

  it("marks only an empty cell", () => {
    const board = ["X", "O", "X", "O", "", "X", "O", "X", "O"];

    expect(
      chooseMove({ gameId: GAME_IDS.TIC_TAC_TOE, game: { view: { board } }, rng, resign: false }),
    ).toEqual({
      cell: 4,
    });
  });

  it("plays a legal chess move", () => {
    const fen = new Chess().fen();
    const move = chooseMove({ gameId: GAME_IDS.CHESS, game: { view: { fen } }, rng, resign: false });

    expect(() => new Chess(fen).move({ from: move.from, to: move.to })).not.toThrow();
    expect(move.type).toBe("move");
  });

  it("promotes to a queen", () => {
    const fen = "8/P7/8/8/8/8/8/k6K w - - 0 1";
    const moves = Array.from({ length: 30 }, () =>
      chooseMove({ gameId: GAME_IDS.CHESS, game: { view: { fen } }, rng, resign: false }),
    );

    expect(moves).toContainEqual({ type: "move", from: "a7", to: "a8", promotion: "q" });
  });

  it("resigns a chess game once it has been told to", () => {
    expect(chooseMove({ gameId: GAME_IDS.CHESS, game: { view: {} }, rng, resign: true })).toEqual({
      type: "resign",
    });
  });
});
