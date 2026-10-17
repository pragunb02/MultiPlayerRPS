import { GAME_IDS } from "@classicade/shared";
import { randomIndex } from "../../rng.js";
import { WINNING_LINES } from "../../tictactoe/tictactoeEngine.js";
import { defineBot } from "../bot.js";

export const TTT_BOT_LEVELS = Object.freeze({ EASY: "easy", MEDIUM: "medium", UNBEATABLE: "unbeatable" });

/** How often Easy notices it can win at once. Missing half its wins is what makes it easy. */
const EASY_SEES_WIN = 0.5;
const CENTER = 4;
const CORNERS = Object.freeze([0, 2, 6, 8]);

const pickRandom = (rng, options) => options[randomIndex(rng, options.length)];
const freeCells = (board) => board.flatMap((cell, index) => (cell === "" ? [index] : []));
const hasLine = (board, mark) => WINNING_LINES.some((line) => line.every((cell) => board[cell] === mark));

/** Free cells where `mark` would complete three in a row. */
const winningCells = (board, mark) =>
  freeCells(board).filter((cell) => hasLine(board.with(cell, mark), mark));

function easy({ board, mine, rng }) {
  const wins = winningCells(board, mine);
  return wins.length > 0 && rng() < EASY_SEES_WIN ? pickRandom(rng, wins) : pickRandom(rng, freeCells(board));
}

/**
 * Wins, then blocks, then prefers the centre and corners, then anything free. It still falls for a fork.
 * The board always has a free cell here, so the last list is never empty.
 */
function medium({ board, mine, theirs, rng }) {
  const candidates = [
    winningCells(board, mine),
    winningCells(board, theirs),
    board[CENTER] === "" ? [CENTER] : [],
    CORNERS.filter((cell) => board[cell] === ""),
    freeCells(board),
  ].find((cells) => cells.length > 0);
  return pickRandom(rng, candidates);
}

/**
 * Best score for the player to move, by full game tree search (minimax). Scores are from the mover's
 * view: a win is worth more the sooner it comes, so the bot finishes games instead of toying with the
 * opponent. Tic-Tac-Toe has only 5,478 positions, so every position solved is remembered for good. The
 * memory can never go stale because a position's score never changes.
 */
const SOLVED = new Map();

function solve(cells, toMove, other) {
  const key = cells.join(",");
  if (!SOLVED.has(key)) {
    const free = freeCells(cells);
    SOLVED.set(
      key,
      free.length === 0 ? 0 : Math.max(...free.map((cell) => scoreAfter(cells, cell, toMove, other))),
    );
  }
  return SOLVED.get(key);
}

function scoreAfter(cells, cell, toMove, other) {
  const next = cells.with(cell, toMove);
  return hasLine(next, toMove) ? 1 + freeCells(next).length : -solve(next, other, toMove);
}

/** Plays one of the best moves, chosen at random between equals so games still vary. */
function unbeatable({ board, mine, theirs, rng }) {
  const free = freeCells(board);
  const scores = free.map((cell) => scoreAfter(board, cell, mine, theirs));
  const best = Math.max(...scores);
  return pickRandom(
    rng,
    free.filter((_, index) => scores[index] === best),
  );
}

const STRATEGIES = Object.freeze({
  [TTT_BOT_LEVELS.EASY]: easy,
  [TTT_BOT_LEVELS.MEDIUM]: medium,
  [TTT_BOT_LEVELS.UNBEATABLE]: unbeatable,
});

/** Tic-Tac-Toe bots, from a casual opponent to one that never loses. */
export const tictactoeBot = defineBot({
  gameId: GAME_IDS.TIC_TAC_TOE,
  levels: [
    { id: TTT_BOT_LEVELS.EASY, name: "Easy", description: "Plays anywhere and often misses a win." },
    {
      id: TTT_BOT_LEVELS.MEDIUM,
      name: "Medium",
      description: "Takes wins and blocks yours, but a clever trap beats it.",
    },
    {
      id: TTT_BOT_LEVELS.UNBEATABLE,
      name: "Unbeatable",
      description: "Plays perfectly. The best you can do is a draw.",
    },
  ],
  chooseMove({ view, botId, rng, difficulty }) {
    const { board, marks } = view;
    if (!board.includes("")) {
      throw new RangeError("The board is full, there is no move to choose");
    }
    const mine = marks[botId];
    const theirs = Object.values(marks).find((mark) => mark !== mine);
    return { cell: STRATEGIES[difficulty]({ board, mine, theirs, rng }) };
  },
});
