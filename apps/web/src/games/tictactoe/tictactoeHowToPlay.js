import { CrossGlyph, GridGlyph, NoughtGlyph } from "../../art/games/glyphs.jsx";
import { step } from "../howToPlay.js";

/** The three steps of the How to play for Tic Tac Toe (CC-259). */
export const TICTACTOE_HOW_TO_PLAY = Object.freeze([
  step(
    GridGlyph,
    "Take turns putting your mark on the 3 by 3 grid.",
    "Baari baari 3 by 3 grid pe apna nishaan lagao.",
  ),
  step(
    CrossGlyph,
    "Get three in a row: across, down or corner to corner.",
    "Teen ek line mein lagao: seedha, khada ya kone se kone.",
  ),
  step(
    NoughtGlyph,
    "Block the other player. A full grid with no row is a draw.",
    "Doosre player ko roko. Grid bhar jaaye aur line na bane, toh draw.",
  ),
]);
