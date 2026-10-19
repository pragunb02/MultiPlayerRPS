/**
 * The words of an outcome moment (CC-163), shared by the room's own endings and each game's. A line is a pair, the
 * Hinglish line first and the English line under it, as the owner chose for every player-facing line of feeling
 * (ADR-051, CC-217). Each is at most 8 words, and a line after a loss never has "!" and never blames the player.
 *
 * @typedef {{ hinglish: string, english: string }} OutcomeLine
 *
 * @typedef {Object} OutcomeNames      the display names already shown in the room
 * @property {string} winner           the player who won, or "" for a draw
 * @property {string} loser            the player who lost, or "" for a draw
 *
 * @typedef {Object} ReasonWords       the lines for one way a game can end, each from one viewer's side
 * @property {(names: OutcomeNames) => OutcomeLine} [won]      the viewer won
 * @property {(names: OutcomeNames) => OutcomeLine} [lost]     the viewer lost
 * @property {(names: OutcomeNames) => OutcomeLine} [drew]     a draw, for players and spectators alike
 * @property {(names: OutcomeNames) => OutcomeLine} [watched]  a spectator of a win
 * @property {boolean} [quiet]         a win this way was not earned on the board, so it gets no confetti
 * @property {string} [lostPhrase]     how the ending reads after "You lost", when the phrase after "You won" would
 *   not read well, such as "to three in a row"
 *
 * @typedef {Object} OutcomeText       what a game adds to the outcome moments, through the client game registry
 * @property {(reason: string) => ReasonWords | undefined} words  the words for one of the game's reasons, undefined
 *   for a reason it does not know
 * @property {(bot: { character: string, level: string }) => OutcomeLine | undefined} [hint]  a computer
 *   character's tip after the player lost to it, from the character's habit (ADR-025)
 */

/**
 * One line of an outcome moment.
 *
 * @param {string} hinglish
 * @param {string} english
 * @returns {Readonly<OutcomeLine>}
 */
export const outcomeLine = (hinglish, english) => Object.freeze({ hinglish, english });

/**
 * A reader of a table of words by reason, which keeps a frozen copy of the table. It reads only the table's own
 * keys: the reason comes from the server, so a name every object inherits (such as "constructor") is never taken
 * for one.
 *
 * @param {Record<string, ReasonWords>} table
 * @returns {(reason: string) => Readonly<ReasonWords> | undefined}
 */
export function wordsFrom(table) {
  const words = Object.freeze(
    Object.fromEntries(Object.entries(table).map(([reason, each]) => [reason, Object.freeze({ ...each })])),
  );
  return (reason) => (Object.hasOwn(words, reason) ? words[reason] : undefined);
}
