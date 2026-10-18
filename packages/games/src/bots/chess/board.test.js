import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { createSeededRng, randomIndex } from "../../rng.js";
import {
  BLACK,
  inCheck,
  legalMoves,
  makeMove,
  moveFromSan,
  parseFen,
  START_FEN,
  squareName,
  unmakeMove,
  WHITE,
} from "./board.js";

/** Counts the leaf positions `depth` moves deep, the standard way to prove a move generator correct. */
function perft(board, depth) {
  if (depth === 0) {
    return 1;
  }
  let total = 0;
  for (const move of legalMoves(board)) {
    makeMove(board, move);
    total += perft(board, depth - 1);
    unmakeMove(board);
  }
  return total;
}

// Generous limits: these walk thousands of positions with chess.js, which is slow under a full parallel run.
const SLOW = 60_000;
// The same random walks at two sizes: a short one for every pull request and the long one for the nightly run.
const RANDOM_WALKS = [
  { games: 3, atLeast: 250, tags: [] },
  { games: 12, atLeast: 1000, tags: ["slow"] },
];

const uci = (move) =>
  `${squareName(move.from)}${squareName(move.to)}${move.promotion === 0 ? "" : " pnbrqk"[move.promotion]}`;

/**
 * Random games played by chess.js. For every position: its FEN, chess.js's legal moves, whether the side
 * to move is in check, the move played in standard notation and the FEN after it. The FEN after a move
 * keeps the en passant square whenever a pawn stands beside it, as the bot's board records it.
 */
function randomGames({ seed, games, plies }) {
  const rng = createSeededRng(seed);
  return Array.from({ length: games }, () => {
    const chess = new Chess();
    const record = [];
    for (let ply = 0; ply < plies; ply += 1) {
      const options = chess.moves({ verbose: true });
      if (options.length === 0) {
        break;
      }
      const fen = chess.fen();
      const check = chess.inCheck();
      const { san } = chess.move(options[randomIndex(rng, options.length)]);
      const legal = options.map((m) => `${m.from}${m.to}${m.promotion ?? ""}`).sort();
      record.push({ fen, legal, check, san, after: chess.fen({ forceEnpassantSquare: true }) });
    }
    return record;
  });
}

// Published move counts (chessprogramming.org "Perft Results"). Together these positions exercise
// castling through check, en passant with pinned pawns, promotions with capture, and discovered checks.
const PERFT = [
  { name: "start position", fen: START_FEN, counts: [20, 400, 8902] },
  {
    name: "Kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [48, 2039, 97862],
  },
  { name: "position 3", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", counts: [14, 191, 2812, 43238] },
  {
    name: "position 4",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [6, 264, 9467],
  },
  {
    name: "position 4 mirrored",
    fen: "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1",
    counts: [6, 264, 9467],
  },
  {
    name: "position 5",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    counts: [44, 1486, 62379],
  },
];

describe("chess bot board: move generation", () => {
  for (const { name, fen, counts } of PERFT) {
    it(
      `counts every line correctly from the ${name}`,
      () => {
        const board = parseFen(fen);

        const found = counts.map((_, index) => perft(board, index + 1));

        expect(found).toEqual(counts);
      },
      SLOW,
    );
  }

  // A few games on every pull request, many more nightly (CC-203).
  for (const { games, atLeast, tags } of RANDOM_WALKS) {
    it(
      `lists exactly the legal moves chess.js lists, all through ${games} random games`,
      { timeout: SLOW, tags },
      () => {
        const positions = randomGames({ seed: 2024, games, plies: 160 }).flat();

        for (const { fen, legal, check } of positions) {
          const board = parseFen(fen);
          expect(legalMoves(board).map(uci).sort()).toEqual(legal);
          expect(inCheck(board)).toBe(check);
        }
        expect(positions.length).toBeGreaterThan(atLeast);
      },
    );
  }

  it("puts every position back exactly as it was after a move is taken back", () => {
    const board = parseFen(PERFT[1].fen);
    const before = { ...board, squares: [...board.squares], kings: [...board.kings], undo: [] };

    for (const move of legalMoves(board)) {
      makeMove(board, move);
      unmakeMove(board);
    }

    expect({ ...board, squares: [...board.squares], kings: [...board.kings] }).toEqual(before);
  });

  it("lists only captures and promotions when asked for tactical moves", () => {
    const board = parseFen("4k3/1P6/8/3p4/4P3/8/8/4K3 w - - 0 1");

    expect(legalMoves(board, { tacticalOnly: true }).map(uci).sort()).toEqual(
      ["b7b8b", "b7b8n", "b7b8q", "b7b8r", "e4d5"].sort(),
    );
  });

  it("reads whose turn it is", () => {
    expect(parseFen(START_FEN).side).toBe(WHITE);
    expect(parseFen("4k3/8/8/8/8/8/8/4K3 b - - 0 1").side).toBe(BLACK);
  });
});

describe("chess bot board: position fingerprints", () => {
  it("gives the same position the same fingerprint however it was reached", () => {
    const viaKnights = parseFen(START_FEN);
    for (const san of ["Nf3", "Nf6", "Ng1", "Ng8"]) {
      makeMove(viaKnights, moveFromSan(viaKnights, san));
    }

    expect(viaKnights.hash).toBe(parseFen(START_FEN).hash);
  });

  for (const { games, tags } of RANDOM_WALKS) {
    it(
      `matches the fingerprint of the same position read from its FEN after every move of ${games} random games`,
      { timeout: SLOW, tags },
      () => {
        for (const game of randomGames({ seed: 7, games, plies: 160 })) {
          const board = parseFen(START_FEN);
          for (const { san, after } of game) {
            makeMove(board, moveFromSan(board, san));
            expect(board.hash).toBe(parseFen(after).hash);
          }
        }
      },
    );
  }

  it("tells apart positions that differ only in castling rights or whose turn it is", () => {
    const base = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");

    expect(parseFen("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1").hash).not.toBe(base.hash);
    expect(parseFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1").hash).not.toBe(base.hash);
  });
});

describe("chess bot board: reading game records", () => {
  it("tells apart two pieces that could reach the same square by file, by rank or by square", () => {
    const board = parseFen("k7/8/8/1Q1Q4/8/1Q6/8/K2R3R w - - 0 1");

    expect(squareName(moveFromSan(board, "Rdf1").from)).toBe("d1");
    expect(squareName(moveFromSan(board, "Qb5c4+").from)).toBe("b5");
    expect(squareName(moveFromSan(board, "Q3b4").from)).toBe("b3");
    expect(squareName(moveFromSan(board, "Qdc4").from)).toBe("d5");
  });

  it("reads castling, en passant and promotion", () => {
    expect(squareName(moveFromSan(parseFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1"), "O-O-O").to)).toBe("c1");
    expect(squareName(moveFromSan(parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"), "exd6").to)).toBe("d6");
    expect(moveFromSan(parseFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1"), "a8=N").promotion).toBe(2);
  });

  it("refuses a move that is not legal in the position", () => {
    expect(() => moveFromSan(parseFen(START_FEN), "e5")).toThrow(RangeError);
  });
});
