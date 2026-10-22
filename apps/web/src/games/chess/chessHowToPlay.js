import { ClockGlyph, KnightGlyph, PawnGlyph } from "../../art/games/glyphs.jsx";
import { step } from "../howToPlay.js";

/** The three steps of the How to play for Chess (CC-259). */
export const CHESS_HOW_TO_PLAY = Object.freeze([
  step(
    PawnGlyph,
    "Tap a piece, then the square to move it to. Or drag it there.",
    "Mohra tap karo, phir woh square jahan le jaana hai. Ya drag karo.",
  ),
  step(
    KnightGlyph,
    "Each piece moves its own way. Checkmate the king to win.",
    "Har mohra apne tareeke se chalta hai. King ko checkmate karo, jeet jao.",
  ),
  step(
    ClockGlyph,
    "Your clock runs only on your turn, so keep an eye on it.",
    "Tumhari ghadi sirf tumhari baari pe chalti hai, us pe nazar rakho.",
  ),
]);
