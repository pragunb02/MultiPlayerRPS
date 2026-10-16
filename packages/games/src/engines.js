import { chessEngine } from "./chess/chessEngine.js";
import { rpsEngine } from "./rps/rpsEngine.js";
import { tictactoeEngine } from "./tictactoe/tictactoeEngine.js";

/**
 * Every playable game, in catalog order. Adding a game = adding its engine here.
 * Nothing else in the system needs to change.
 *
 * @type {ReadonlyArray<Readonly<import("./engine.js").GameEngine<any, any, any>>>}
 */
export const ENGINES = Object.freeze([rpsEngine, tictactoeEngine, chessEngine]);
