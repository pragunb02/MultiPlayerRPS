import { chessBot } from "./chess/chessBot.js";
import { rpsBot } from "./rps/rpsBot.js";
import { tictactoeBot } from "./tictactoe/tictactoeBot.js";

/**
 * A bot for every game, in catalog order. Adding a bot means adding it here, nothing else changes.
 *
 * @type {ReadonlyArray<Readonly<import("./bot.js").Bot>>}
 */
export const BOTS = Object.freeze([rpsBot, tictactoeBot, chessBot]);
