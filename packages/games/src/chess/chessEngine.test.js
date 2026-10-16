import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { MOVE_REJECTIONS } from "@classicade/shared";
import { createSeededRng } from "../rng.js";
import { describeEngineContract } from "../testing/engineContract.js";
import { chessEngine } from "./chessEngine.js";

const A = "alice";
const B = "bob";
const T0 = 1_700_000_000_000;

// Seed 42 makes bob White. Fool's mate: 1. f3 e5 2. g4 Qh4#.
describeEngineContract(
  chessEngine,
  {
    players: [A, B],
    options: { timeControl: "blitz-5+0" },
    invalidOptions: [{ timeControl: "blitz-4+0" }, { timeControl: "blitz-5+0", rated: true }, null, "x", []],
    seed: 42,
    playthrough: [
      { player: B, move: { type: "move", from: "f2", to: "f3" } },
      { player: A, move: { type: "move", from: "e7", to: "e5" } },
      { player: B, move: { type: "move", from: "g2", to: "g4" } },
      { player: A, move: { type: "move", from: "d8", to: "h4" } },
    ],
    expectedOutcome: { status: "finished", result: "win", winners: [A], reason: "checkmate" },
    rejectedMoves: [
      { player: A, move: { type: "move", from: "e7", to: "e5" }, reason: MOVE_REJECTIONS.NOT_YOUR_TURN },
      { player: B, move: { type: "move", from: "e2", to: "e5" }, reason: MOVE_REJECTIONS.ILLEGAL_MOVE },
      { player: B, move: { type: "move", from: "z9", to: "e4" }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      { player: B, move: { type: "castle" }, reason: MOVE_REJECTIONS.INVALID_MOVE },
      {
        player: B,
        move: { type: "move", from: "e2", to: "e4", promotion: "k" },
        reason: MOVE_REJECTIONS.INVALID_MOVE,
      },
      { player: A, move: { type: "accept-draw" }, reason: MOVE_REJECTIONS.ILLEGAL_MOVE },
    ],
  },
  { describe, it },
);

/** A new game: seed 42 → bob is White. */
const newGame = (timeControl = "blitz-5+0") =>
  chessEngine.init({ players: [A, B], options: { timeControl }, rng: createSeededRng(42) });

const sideToMove = (state) => state.byColor[state.fen.split(" ")[1]];

/** Plays one action for `player` at time `now`, failing loudly if the engine rejects it. */
function act(state, player, move, now = T0) {
  const validated = chessEngine.validateMove(state, player, move, { now });
  if (!validated.ok) {
    throw new Error(`${JSON.stringify(move)} by ${player} rejected: ${validated.reason}`);
  }
  return chessEngine.applyMove(state, player, validated.value, { now });
}

/** Plays moves written in SAN (chess.js translates them to squares, only in this test). */
function playSan(state, sans, now = T0) {
  return sans.reduce((current, san) => {
    const { from, to, promotion } = new Chess(current.fen).move(san);
    return act(
      current,
      sideToMove(current),
      promotion ? { type: "move", from, to, promotion } : { type: "move", from, to },
      now,
    );
  }, state);
}

describe("chessEngine setup", () => {
  it("gives White to the seeded player and starts from the initial position", () => {
    const state = newGame();

    expect(state.colors).toEqual({ [B]: "w", [A]: "b" });
    expect(state.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(chessEngine.activePlayers(state)).toEqual([B]);
  });

  it("assigns White fairly across seeds", () => {
    const whites = Array.from({ length: 1_000 }, (_, seed) =>
      chessEngine.init({
        players: [A, B],
        options: { timeControl: "blitz-5+0" },
        rng: createSeededRng(seed),
      }),
    ).filter((state) => state.byColor.w === B).length;

    expect(whites).toBeGreaterThan(400);
    expect(whites).toBeLessThan(600);
  });

  it("defaults to blitz 5+0 and validates time controls", () => {
    expect(chessEngine.validateOptions({})).toEqual({ ok: true, value: { timeControl: "blitz-5+0" } });
    expect(chessEngine.validateOptions({ timeControl: "rapid-15+10" }).ok).toBe(true);
    expect(chessEngine.validateOptions({ timeControl: "classical" }).message).toMatch(
      /timeControl must be one of/,
    );
  });
});

describe("chessEngine endings", () => {
  it("detects checkmate (scholar's mate)", () => {
    const state = playSan(newGame(), ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);

    expect(chessEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: [B],
      reason: "checkmate",
    });
  });

  it("detects stalemate (Sam Loyd's 10-move stalemate)", () => {
    const sans = [
      "e3",
      "a5",
      "Qh5",
      "Ra6",
      "Qxa5",
      "h5",
      "h4",
      "Rah6",
      "Qxc7",
      "f6",
      "Qxd7+",
      "Kf7",
      "Qxb7",
      "Qd3",
      "Qxb8",
      "Qh7",
      "Qxc8",
      "Kg6",
      "Qe6",
    ];

    const state = playSan(newGame(), sans);

    expect(chessEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "stalemate",
    });
  });

  it("detects threefold repetition across the whole game history", () => {
    const state = playSan(newGame(), ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);

    expect(chessEngine.getOutcome(state).reason).toBe("threefold-repetition");
  });

  it("lets either player resign at any time, even when it is not their turn", () => {
    const state = act(newGame(), A, { type: "resign" });

    expect(chessEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "win",
      winners: [B],
      reason: "resignation",
    });
  });
});

describe("chessEngine promotion", () => {
  // 1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. axb7 Nc6 → White pawn on b7 with b8 free.
  const readyToPromote = () => playSan(newGame(), ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6"]);

  it("requires choosing a piece", () => {
    expect(
      chessEngine.validateMove(readyToPromote(), B, { type: "move", from: "b7", to: "b8" }, { now: T0 }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        reason: MOVE_REJECTIONS.INVALID_MOVE,
        message: "Choose a piece to promote to",
      }),
    );
  });

  it.each([
    ["q", "b8=Q"],
    ["n", "b8=N"],
  ])("promotes to %s", (promotion, san) => {
    const state = act(readyToPromote(), B, { type: "move", from: "b7", to: "b8", promotion });

    expect(chessEngine.viewFor(state, A).moves.at(-1)).toBe(san);
  });
});

describe("chessEngine draw offers", () => {
  it("ends in agreement when the opponent accepts", () => {
    const state = act(act(newGame(), B, { type: "offer-draw" }), A, { type: "accept-draw" });

    expect(chessEngine.getOutcome(state)).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "agreement",
    });
  });

  it("treats a counter-offer as agreement", () => {
    const state = act(act(newGame(), B, { type: "offer-draw" }), A, { type: "offer-draw" });

    expect(chessEngine.getOutcome(state).reason).toBe("agreement");
  });

  it("refuses offering twice and accepting your own offer", () => {
    const offered = act(newGame(), B, { type: "offer-draw" });

    expect(chessEngine.validateMove(offered, B, { type: "offer-draw" }, { now: T0 }).reason).toBe(
      MOVE_REJECTIONS.ILLEGAL_MOVE,
    );
    expect(chessEngine.validateMove(offered, B, { type: "accept-draw" }, { now: T0 }).reason).toBe(
      MOVE_REJECTIONS.ILLEGAL_MOVE,
    );
  });

  it("is declined by the opponent making a move instead", () => {
    const offeredByWhite = playSan(act(newGame(), B, { type: "offer-draw" }), ["e4"]);
    expect(offeredByWhite.drawOfferBy).toBe(B); // your own move keeps your offer standing

    const declined = playSan(offeredByWhite, ["e5"]);
    expect(declined.drawOfferBy).toBe("");
  });
});

describe("chessEngine clocks", () => {
  it("does not run the clocks before White's first move", () => {
    const state = newGame();

    expect(chessEngine.deadline(state)).toBe(0);
    expect(playSan(state, ["e4"], T0 + 60_000).clocks).toEqual({ w: 300_000, b: 300_000 });
  });

  it("charges each side the time it took, and adds the increment", () => {
    let state = newGame("blitz-3+2");
    state = playSan(state, ["e4"], T0); // clocks start now
    state = playSan(state, ["e5"], T0 + 10_000); // Black took 10 s: 180 − 10 + 2

    expect(state.clocks).toEqual({ w: 180_000, b: 172_000 });
    expect(chessEngine.deadline(state)).toBe(T0 + 10_000 + 180_000);
  });

  it("loses on time when a move arrives after the flag fell", () => {
    const state = playSan(newGame(), ["e4"], T0);

    const validated = chessEngine.validateMove(
      state,
      A,
      { type: "move", from: "e7", to: "e5" },
      { now: T0 + 300_000 },
    );
    const after = chessEngine.applyMove(state, A, validated.value, { now: T0 + 300_000 });

    expect(chessEngine.getOutcome(after)).toEqual({
      status: "finished",
      result: "win",
      winners: [B],
      reason: "timeout",
    });
    expect(after.clocks.b).toBe(0);
  });

  it("expires exactly at the deadline, not before", () => {
    const state = playSan(newGame(), ["e4"], T0);
    const due = chessEngine.deadline(state);

    expect(chessEngine.expire(state, { now: due - 1 })).toBe(state);
    expect(chessEngine.getOutcome(chessEngine.expire(state, { now: due })).reason).toBe("timeout");
  });

  it("has no deadline once the game is over", () => {
    const state = act(playSan(newGame(), ["e4"]), A, { type: "resign" });

    expect(chessEngine.deadline(state)).toBe(0);
  });

  it("draws instead of losing on time when the opponent cannot possibly checkmate (FIDE 6.9)", () => {
    // Fixture position: White (bob) has a lone king, Black (alice) to move with king + queen and no time left.
    const lonelyWhiteKing = {
      ...playSan(newGame(), ["e4"], T0),
      fen: "4k3/8/8/8/3q4/8/8/4K3 b - - 0 40",
    };

    const expired = chessEngine.expire(lonelyWhiteKing, { now: T0 + 300_000 });

    expect(chessEngine.getOutcome(expired)).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "timeout-vs-insufficient-material",
    });
  });
});

describe("chessEngine view", () => {
  it("shows the position, history, last move, clocks and whose turn it is", () => {
    const state = playSan(newGame(), ["e4", "e5", "Qh5"], T0);

    expect(chessEngine.viewFor(state, "spectator")).toEqual({
      fen: state.fen,
      moves: ["e4", "e5", "Qh5"],
      lastMove: { from: "d1", to: "h5" },
      colors: { [B]: "w", [A]: "b" },
      toMove: A,
      inCheck: false,
      timeControl: "blitz-5+0",
      clocks: { w: 300_000, b: 300_000 },
      lastMoveAt: T0,
      drawOfferBy: "",
    });
  });

  it("reports check", () => {
    const state = playSan(newGame(), ["e4", "f5", "Qh5+"]);

    expect(chessEngine.viewFor(state, A).inCheck).toBe(true);
  });
});
