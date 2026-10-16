import { GAME_IDS } from "@classicade/shared";
import { RockGlyph } from "../rps/hands.jsx";
import { ChessArt } from "./ChessArt.jsx";
import { GenericGameArt } from "./GenericGameArt.jsx";
import { GridGlyph, JoystickGlyph, KnightGlyph } from "./glyphs.jsx";
import { RpsArt } from "./RpsArt.jsx";
import { TicTacToeArt } from "./TicTacToeArt.jsx";

/**
 * @typedef {Object} GameArtEntry
 * @property {import("react").ComponentType<{ title?: string, className?: string }>} Art   card illustration
 * @property {import("react").ComponentType} Glyph   small 64 × 64 glyph for icons
 * @property {string} tone   the game's accent: a CSS-module class name, backed by --color-game-<tone>
 */

/**
 * The art for each game, by game id. A new game adds one entry; until it does, it gets the joystick (FALLBACK),
 * so the catalog never breaks when the server knows a game this build doesn't.
 *
 * @type {Readonly<Record<string, Readonly<GameArtEntry>>>}
 */
export const GAME_ART = Object.freeze({
  [GAME_IDS.RPS]: Object.freeze({ Art: RpsArt, Glyph: RockGlyph, tone: "rps" }),
  [GAME_IDS.TIC_TAC_TOE]: Object.freeze({ Art: TicTacToeArt, Glyph: GridGlyph, tone: "tictactoe" }),
  [GAME_IDS.CHESS]: Object.freeze({ Art: ChessArt, Glyph: KnightGlyph, tone: "chess" }),
});

export const FALLBACK_GAME_ART = Object.freeze({
  Art: GenericGameArt,
  Glyph: JoystickGlyph,
  tone: "primary",
});

/** @param {string} gameId @returns {Readonly<GameArtEntry>} */
export const gameArtFor = (gameId) => GAME_ART[gameId] ?? FALLBACK_GAME_ART;
