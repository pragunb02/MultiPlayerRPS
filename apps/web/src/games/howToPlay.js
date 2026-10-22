import { GAME_IDS } from "@classicade/shared";
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
 * @property {string} hinglish                       the same sentence in Hinglish, with "tum", for the pages that
 *   speak Hinglish (CC-217, CC-349)
 */

const step = (Glyph, text, hinglish) => Object.freeze({ Glyph, text, hinglish });

/** The three steps of the lobby's "How to play" strip for Rock Paper Scissors (CC-259). */
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

/** The three steps of the lobby's "How to play" strip for Tic Tac Toe (CC-259). */
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

/** The three steps of the lobby's "How to play" strip for Chess (CC-259). */
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

/**
 * The most a game's How to play may hold (check A2 of the clarity audit, CC-349): three steps, each shorter than 90
 * characters, so the steps read at a glance in the lobby, on an invite and in the game's dialog.
 */
export const HOW_TO_PLAY_LIMITS = Object.freeze({ steps: 3, characters: 90 });

/**
 * Every game's steps by game id (CC-349). Only the pages that show them import this file, so the steps download
 * with a lobby, an invite, a challenge or a match and never with the first page. The registry's `loadHowToPlay`
 * loads the same lists.
 */
const HOW_TO_PLAY = Object.freeze({
  [GAME_IDS.RPS]: RPS_HOW_TO_PLAY,
  [GAME_IDS.TIC_TAC_TOE]: TICTACTOE_HOW_TO_PLAY,
  [GAME_IDS.CHESS]: CHESS_HOW_TO_PLAY,
});

const NO_STEPS = Object.freeze([]);

/** What each game is, in one line under the lobby's title (CL-16 of the clarity audit, CC-349). */
const LEADS = Object.freeze({
  [GAME_IDS.RPS]: "Pick rock, paper or scissors and beat the other pick.",
  [GAME_IDS.TIC_TAC_TOE]: "Get three in a row before the other player.",
  [GAME_IDS.CHESS]: "Checkmate the other king to win.",
});

/**
 * @param {string} gameId
 * @returns {string} what the game is in one sentence, or "" for a game the web app has no line for yet
 */
export const gameLeadFor = (gameId) => LEADS[gameId] ?? "";

/**
 * @param {string} gameId
 * @returns {ReadonlyArray<HowToPlayStep>} the game's steps, or none for a game the web app has none for yet
 */
export const howToPlayFor = (gameId) => HOW_TO_PLAY[gameId] ?? NO_STEPS;

/**
 * @param {ReadonlyArray<unknown>} steps
 * @returns {string} "3 steps", or "1 step", for the line "How to play: 3 steps"
 */
export const stepCount = (steps) => `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
