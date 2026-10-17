// Measures how many chess moves per second the engine can check and play at different points of a game (CC-180).
// Run with `node scripts/bin/bench-chess.mjs`. It plays one long game of seeded random moves, then times one more
// move (validateMove and applyMove together) from the positions after 10, 100 and 300 half moves.
import { performance } from "node:perf_hooks";

import { Chess } from "chess.js";

import { createSeededRng } from "../../packages/games/src/rng.js";
import { chessEngine } from "../../packages/games/src/chess/chessEngine.js";

const PLIES = [10, 100, 300];
const LONGEST = Math.max(...PLIES) + 1;
const RUN_MS = 1500;
const T0 = 1_700_000_000_000;

/** Finds a seeded random game that is still going after `length` half moves. */
function longGame(length) {
  for (let seed = 1; ; seed += 1) {
    const rng = createSeededRng(seed);
    const chess = new Chess();
    const moves = [];
    while (moves.length < length && !chess.isGameOver()) {
      const legal = chess.moves({ verbose: true });
      const { from, to, promotion } = legal[Math.floor(rng() * legal.length)];
      chess.move({ from, to, promotion });
      moves.push(promotion ? { from, to, promotion } : { from, to });
    }
    if (moves.length === length) {
      return moves;
    }
  }
}

const moves = longGame(LONGEST);
const players = ["alice", "bob"];
const start = chessEngine.init({
  players,
  options: { timeControl: "rapid-10+0" },
  rng: createSeededRng(42),
});
const mover = (state) => state.byColor[state.fen.split(" ")[1]];
const play = (state, move) => {
  const player = mover(state);
  const checked = chessEngine.validateMove(state, player, { type: "move", ...move }, { now: T0 });
  if (!checked.ok) {
    throw new Error(`Move ${JSON.stringify(move)} was refused: ${checked.message}`);
  }
  return chessEngine.applyMove(state, player, checked.value, { now: T0 });
};

const states = [start];
for (const move of moves) {
  states.push(play(states.at(-1), move));
}

for (const ply of PLIES) {
  const state = states[ply];
  const next = moves[ply];
  let count = 0;
  const began = performance.now();
  while (performance.now() - began < RUN_MS) {
    play(state, next);
    count += 1;
  }
  const seconds = (performance.now() - began) / 1000;
  process.stdout.write(
    `after ${String(ply).padStart(3)} half moves: ${Math.round(count / seconds)
      .toString()
      .padStart(7)} moves per second (${((seconds * 1000) / count).toFixed(3)} ms each)\n`,
  );
}
