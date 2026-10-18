import {
  ClockGlyph,
  CrossGlyph,
  GridGlyph,
  KnightGlyph,
  NoughtGlyph,
  PawnGlyph,
} from "../art/games/glyphs.jsx";
import { PaperGlyph, RockGlyph, ScissorsGlyph } from "../art/rps/hands.jsx";

/**
 * @typedef {Object} HowToPlayStep
 * @property {import("react").ComponentType} Glyph  a 64 x 64 glyph drawn beside the words, as decoration
 * @property {string} text                           one short sentence
 */

const step = (Glyph, text) => Object.freeze({ Glyph, text });

/** The three steps of the lobby's "How to play" strip for Rock Paper Scissors (CC-259). */
export const RPS_HOW_TO_PLAY = Object.freeze([
  step(RockGlyph, "You both pick rock, paper or scissors in secret."),
  step(PaperGlyph, "Rock beats scissors, scissors beat paper, paper beats rock."),
  step(ScissorsGlyph, "Win more than half of the rounds to take the match."),
]);

/** The three steps of the lobby's "How to play" strip for Tic Tac Toe (CC-259). */
export const TICTACTOE_HOW_TO_PLAY = Object.freeze([
  step(GridGlyph, "Take turns putting your mark on the 3 by 3 grid."),
  step(CrossGlyph, "Get three in a row: across, down or corner to corner."),
  step(NoughtGlyph, "Block the other player. A full grid with no row is a draw."),
]);

/** The three steps of the lobby's "How to play" strip for Chess (CC-259). */
export const CHESS_HOW_TO_PLAY = Object.freeze([
  step(PawnGlyph, "Tap a piece, then the square to move it to. Or drag it there."),
  step(KnightGlyph, "Each piece moves its own way. Checkmate the king to win."),
  step(ClockGlyph, "Your clock runs only on your turn, so keep an eye on it."),
]);
