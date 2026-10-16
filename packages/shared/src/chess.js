/** Chess vocabulary shared by the engine and the web client. */

/** Time-control presets: "<minutes>+<increment seconds>". Clocks start after White's first move. */
export const CHESS_TIME_CONTROLS = Object.freeze({
  "bullet-1+0": Object.freeze({ initialSeconds: 60, incrementSeconds: 0 }),
  "blitz-3+2": Object.freeze({ initialSeconds: 180, incrementSeconds: 2 }),
  "blitz-5+0": Object.freeze({ initialSeconds: 300, incrementSeconds: 0 }),
  "rapid-10+0": Object.freeze({ initialSeconds: 600, incrementSeconds: 0 }),
  "rapid-15+10": Object.freeze({ initialSeconds: 900, incrementSeconds: 10 }),
});
export const DEFAULT_CHESS_TIME_CONTROL = "blitz-5+0";

/** Actions a chess player can send as `move.type`. */
export const CHESS_ACTIONS = Object.freeze({
  MOVE: "move",
  RESIGN: "resign",
  OFFER_DRAW: "offer-draw",
  ACCEPT_DRAW: "accept-draw",
});

export const CHESS_PROMOTIONS = Object.freeze(["q", "r", "b", "n"]);

/** Why a chess game ended (the outcome's `reason`). */
export const CHESS_END_REASONS = Object.freeze({
  CHECKMATE: "checkmate",
  STALEMATE: "stalemate",
  INSUFFICIENT_MATERIAL: "insufficient-material",
  THREEFOLD_REPETITION: "threefold-repetition",
  FIFTY_MOVE_RULE: "fifty-move-rule",
  RESIGNATION: "resignation",
  AGREEMENT: "agreement",
  TIMEOUT: "timeout",
  TIMEOUT_VS_INSUFFICIENT_MATERIAL: "timeout-vs-insufficient-material",
});
