import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { createSeededRng } from "../../rng.js";
import { makeMove, moveFromSan, parseFen, START_FEN, squareName } from "./board.js";
import { evaluate, MATE, scoreMoves, searchMove } from "./search.js";

const FORCED_MATE = MATE - 1_000;
const search = (fen, limits = {}) =>
  searchMove(parseFen(fen), { maxDepth: 4, maxNodes: 200_000, rng: createSeededRng(1), ...limits });
const uci = ({ from, to }) => `${squareName(from)}${squareName(to)}`;

/** A board after playing `sans` from `fen`, so the bot remembers the positions on the way. */
function after(fen, sans) {
  const board = parseFen(fen);
  sans.forEach((san) => makeMove(board, moveFromSan(board, san)));
  return board;
}

describe("chess bot evaluation", () => {
  it("scores the starting position as level", () => {
    expect(evaluate(parseFen(START_FEN))).toBe(0);
  });

  it("scores a position from the side to move, so swapping the mover flips the sign", () => {
    const white = evaluate(parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1"));
    const black = evaluate(parseFen("4k3/8/8/8/8/8/8/3QK3 b - - 0 1"));

    expect(white).toBeGreaterThan(800);
    expect(black).toBe(-white);
  });

  it("scores mirrored positions the same for either colour", () => {
    expect(evaluate(parseFen("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"))).toBe(
      evaluate(parseFen("rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 2 3")),
    );
  });

  it("wants its king in the centre once the board empties, and in its corner before", () => {
    const endgameCentre = evaluate(parseFen("4k3/pppp4/8/8/3K4/8/PPPP4/8 w - - 0 1"));
    const endgameCorner = evaluate(parseFen("4k3/pppp4/8/8/8/8/PPPP4/K7 w - - 0 1"));
    const middlegameCorner = evaluate(parseFen("rnbqk2r/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1RK1 w kq - 0 1"));
    const middlegameCentre = evaluate(parseFen("rnbqk2r/pppppppp/8/8/8/4K3/PPPPPPPP/RNBQ1R2 w kq - 0 1"));

    expect(endgameCentre).toBeGreaterThan(endgameCorner);
    expect(middlegameCorner).toBeGreaterThan(middlegameCentre);
  });

  it("when far ahead, prefers the lone king at the edge with its own king close", () => {
    const hunted = evaluate(parseFen("7k/8/6K1/8/8/8/8/Q7 w - - 0 1"));
    const free = evaluate(parseFen("8/8/8/3k4/8/8/8/Q6K w - - 0 1"));
    const lonelyBlack = evaluate(parseFen("q7/8/8/8/8/6k1/8/7K b - - 0 1"));

    expect(hunted).toBeGreaterThan(free);
    expect(lonelyBlack).toBe(hunted);
  });
});

describe("chess bot search", () => {
  it("finds a mate in one", () => {
    const found = search("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");

    expect(uci(found.move)).toBe("a1a8");
    expect(found.score).toBeGreaterThan(FORCED_MATE);
  });

  it("finds a mate in two, for either colour", () => {
    expect(uci(search("kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1").move)).toBe("a1a6");
    expect(uci(search("r7/8/8/8/8/1p6/PP6/KBk5 b - - 0 1").move)).toBe("a8a3");
  });

  it("takes a free queen", () => {
    expect(uci(search("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1", { maxDepth: 2 }).move)).toBe("d1d5");
  });

  it("does not take a pawn when the queen would be lost for it", () => {
    // Qxd5 is met by exd5 or cxd5, so the exchange search must see the recapture.
    const found = search("4k3/8/2p1p3/3p4/8/8/8/3QK3 w - - 0 1", { maxDepth: 1 });

    expect(uci(found.move)).not.toBe("d1d5");
  });

  it("still answers when every move loses to mate, and knows it is lost", () => {
    const found = search("7k/8/6K1/8/8/8/8/R7 b - - 0 1");

    expect(uci(found.move)).toBe("h8g8");
    expect(found.score).toBeLessThan(-FORCED_MATE);
  });

  it("scores a stalemate as a draw, so a winning side never stalemates", () => {
    // Black's king on a8 has no square, so most quiet White moves would stalemate it.
    const fen = "k7/8/1Q6/8/8/8/8/7K w - - 0 1";
    const scores = scoreMoves(parseFen(fen), { depth: 2 });
    const found = search(fen);
    const chess = new Chess(fen);
    chess.move({ from: squareName(found.move.from), to: squareName(found.move.to) });

    expect(scores.find(({ move }) => uci(move) === "h1g1").score).toBe(0);
    expect(chess.isStalemate()).toBe(false);
    expect(found.score).toBeGreaterThan(500);
  });

  it("scores a move that completes fifty moves without a capture or pawn move as a draw", () => {
    // Black is a queen down, but any move now reaches the fifty move rule.
    const found = search("k7/8/8/8/8/8/8/Q6K b - - 99 80");

    expect(found.score).toBe(0);
  });

  it("heads for a repeated position when it is losing, and scores it as a draw", () => {
    // White is a queen up. Black's knight going back from f7 to h8 repeats the first position.
    const board = after("k6n/8/8/8/8/8/8/KQ6 w - - 0 1", ["Ka2", "Nf7", "Ka1"]);
    const scores = scoreMoves(board, { depth: 1 });
    const found = searchMove(board, { maxDepth: 3, maxNodes: 200_000, rng: createSeededRng(1) });

    expect(scores.find(({ move }) => uci(move) === "f7h8").score).toBe(0);
    expect(uci(found.move)).toBe("f7h8");
  });

  it("stops after the first complete round when the position budget is tiny, with a legal move", () => {
    const tiny = search(START_FEN, { maxDepth: 6, maxNodes: 10 });
    const roomy = search(START_FEN, { maxDepth: 3 });

    expect(tiny.depth).toBe(1);
    expect(new Chess().moves({ verbose: true }).map((m) => m.from + m.to)).toContain(uci(tiny.move));
    expect(roomy.depth).toBe(3);
  });

  it("never looks at many more positions than its budget allows", () => {
    // Once over budget every open line returns at once, so the overshoot is at most a few per root move.
    const middlegame = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    const found = search(middlegame, { maxDepth: 8, maxNodes: 5_000 });

    expect(found.nodes).toBeGreaterThan(5_000);
    expect(found.nodes).toBeLessThan(5_000 + 200);
    expect(found.depth).toBeLessThan(8);
  });

  it("gives the same answer for the same seed and position, and leaves the board as it found it", () => {
    const board = parseFen(START_FEN);
    const before = { ...board, squares: [...board.squares] };
    const first = searchMove(board, { maxDepth: 3, maxNodes: 50_000, rng: createSeededRng(9) });
    const second = searchMove(board, { maxDepth: 3, maxNodes: 50_000, rng: createSeededRng(9) });

    expect(uci(first.move)).toBe(uci(second.move));
    expect(first.nodes).toBe(second.nodes);
    expect({ ...board, squares: [...board.squares] }).toEqual(before);
  });

  it("varies between equally good moves with the seed", () => {
    const openings = new Set(
      Array.from({ length: 12 }, (_, seed) =>
        uci(
          searchMove(parseFen(START_FEN), { maxDepth: 1, maxNodes: 1_000, rng: createSeededRng(seed) }).move,
        ),
      ),
    );

    expect(openings.size).toBeGreaterThan(1);
  });
});
