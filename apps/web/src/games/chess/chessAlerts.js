import { CHESS_END_REASONS as END, CHESS_REQUEST_TYPES } from "@classicade/shared";
import { SOUNDS } from "../../lib/sound/sounds.js";
import { outcomeLine as line, wordsFrom } from "../outcomeLine.js";

/**
 * The sound a chess move makes, read from its notation: a check ("+") is announced over everything else, then
 * castling ("O-O", "O-O-O"), then a capture ("x"). A checkmate ("#") sounds like the move that gave it, and the
 * result sound follows.
 *
 * @param {string} san  the move in standard algebraic notation, such as "Nxe5+"
 */
export function soundForSan(san) {
  if (san.includes("+")) return SOUNDS.CHECK;
  if (san.startsWith("O-O")) return SOUNDS.CASTLE;
  if (san.includes("x")) return SOUNDS.CAPTURE;
  return SOUNDS.MOVE;
}

/**
 * Chess sounds between two views of the same game (CC-103): the newest move's sound when a move was made.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function chessSounds(previous, next) {
  const moves = next.game.view.moves;
  return moves.length > previous.game.view.moves.length ? [soundForSan(moves.at(-1))] : [];
}

/**
 * The words of the chess requests (CC-159): a draw offer, which the room keeps like every other request. Moving
 * instead of answering declines it, so the offerer hears "declined" then as well.
 *
 * @type {Readonly<Record<string, import("../roomUpdates.js").RequestTexts>>}
 */
export const CHESS_REQUEST_TEXTS = Object.freeze({
  [CHESS_REQUEST_TYPES.DRAW]: Object.freeze({
    title: "Draw offer",
    waitingTitle: "Draw offered",
    question: (name) => `${name} offers a draw.`,
    waiting: (name) => `Draw offered. Waiting for ${name} to answer`,
    declined: (name) => `${name} declined your draw offer`,
    withdrawn: (name) => `${name} withdrew the draw offer`,
    accepted: (name) => `${name} accepted the draw`,
    site: (game) => `offers a draw at ${game}`,
  }),
});

const REASON_PHRASES = Object.freeze({
  [END.CHECKMATE]: "by checkmate",
  [END.STALEMATE]: "by stalemate",
  [END.INSUFFICIENT_MATERIAL]: "by insufficient material",
  [END.THREEFOLD_REPETITION]: "by threefold repetition",
  [END.FIFTY_MOVE_RULE]: "by the fifty-move rule",
  [END.RESIGNATION]: "by resignation",
  [END.AGREEMENT]: "by agreement",
  [END.TIMEOUT]: "on time",
  [END.TIMEOUT_VS_INSUFFICIENT_MATERIAL]: "on time with too little material to win",
});

/**
 * How a chess game ended, as the end of the result headline (CC-162): "You won by checkmate", "You lost on time",
 * "Draw by agreement". Empty for a reason this version does not know, so the headline still reads well.
 *
 * @param {string} reason  the outcome's reason (CHESS_END_REASONS)
 */
export const chessReasonPhrase = (reason) => REASON_PHRASES[reason] ?? "";

// Most draws are the board's own doing, so one line fits them all.
const NOBODY_COULD_WIN = {
  drew: () => line("Yeh game koi nahi jeet sakta tha.", "Nobody could win that one."),
};

/** The words of each chess ending (CC-163). The Hinglish lines are drafts for the owner (docs/tickets/CC-163.md). */
const OUTCOME_WORDS = {
  [END.CHECKMATE]: {
    won: () => line("Ekdum saaf finish.", "Clean finish."),
    lost: () => line("Achha game tha. Ek aur?", "Good game. Want another?"),
  },
  [END.RESIGNATION]: {
    won: ({ loser }) => line(`${loser} ne haar maan li.`, `${loser} resigned.`),
    lost: () => line("Naya board lagayein?", "Fresh board?"),
    watched: ({ loser }) => line(`${loser} ne haar maan li.`, `${loser} resigned.`),
  },
  [END.TIMEOUT]: {
    won: ({ loser }) => line(`${loser} ka time khatam ho gaya.`, `${loser}'s clock ran out.`),
    lost: () => line("Kaafi close tha. Agli baar lamba clock lo.", "Close one. Try a longer clock next."),
    watched: ({ loser }) => line(`${loser} ka time khatam ho gaya.`, `${loser}'s clock ran out.`),
  },
  [END.STALEMATE]: NOBODY_COULD_WIN,
  [END.INSUFFICIENT_MATERIAL]: NOBODY_COULD_WIN,
  [END.THREEFOLD_REPETITION]: NOBODY_COULD_WIN,
  [END.FIFTY_MOVE_RULE]: NOBODY_COULD_WIN,
  [END.AGREEMENT]: { drew: () => line("Dono players ne draw maan liya.", "Both players agreed on a draw.") },
  [END.TIMEOUT_VS_INSUFFICIENT_MATERIAL]: {
    drew: () => line("Time khatam, par mate mumkin nahi tha.", "Time ran out, but no mate was possible."),
  },
};

/**
 * What chess adds to the outcome moments (CC-163): the words of each ending, and Queen Vee's tip after a loss.
 *
 * @type {import("../outcomeLine.js").OutcomeText}
 */
export const CHESS_OUTCOME_TEXT = Object.freeze({
  words: wordsFrom(OUTCOME_WORDS),
  hint: ({ character }) =>
    character === "queen-vee"
      ? line(
          "Queen Vee pehle attack karti hai. Pieces bachao.",
          "Queen Vee attacks first. Guard your pieces.",
        )
      : undefined,
});
