import { PaperGlyph, RockGlyph, ScissorsGlyph } from "../../art/rps/hands.jsx";
import { step } from "../howToPlay.js";

/** The three steps of the How to play for Rock Paper Scissors (CC-259). */
export const RPS_HOW_TO_PLAY = Object.freeze([
  step(
    RockGlyph,
    "You both pick rock, paper or scissors in secret.",
    "Tum dono chupke se rock, paper ya scissors chuno.",
  ),
  step(
    PaperGlyph,
    "Rock beats scissors, scissors beat paper, paper beats rock.",
    "Rock scissors ko harata hai, scissors paper ko, paper rock ko.",
  ),
  step(
    ScissorsGlyph,
    "Win more than half of the rounds to take the match.",
    "Aadhe se zyada rounds jeeto, toh match tumhara.",
  ),
]);
