/**
 * A small chess puzzle set for tests (CC-144), two puzzles from the Lichess puzzle database (CC0). Days follow the
 * set from Monday 2026-10-19, so even day numbers get `TWO_STEPS` and odd ones `MATE_IN_ONE`: Tuesday 2026-10-20 is
 * puzzle #2, `TWO_STEPS`.
 */

/** Lichess 001KR: after Black's Kg8, White mates with Rf8 (Rd8 mates too). */
export const MATE_IN_ONE = Object.freeze({
  id: "001KR",
  fen: "6Qk/p1p3pp/4N3/1p6/2q1r1n1/2B5/PP4PP/3R1R1K b - - 0 28",
  moves: Object.freeze(["h8g8", "f1f8"]),
  rating: 563,
  themes: Object.freeze(["mate", "mateIn1", "oneMove", "middlegame"]),
});

/** Lichess 0000D: after White's Qd6, Black finds Rd8, White takes Qxd8+ and Black finds Bxd8. */
export const TWO_STEPS = Object.freeze({
  id: "0000D",
  fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27",
  moves: Object.freeze(["d3d6", "f8d8", "d6d8", "f6d8"]),
  rating: 1529,
  themes: Object.freeze(["advantage", "endgame", "short"]),
});

export const TEST_CHESS_PUZZLES = Object.freeze([MATE_IN_ONE, TWO_STEPS]);
