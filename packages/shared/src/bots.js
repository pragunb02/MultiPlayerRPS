import { GAME_IDS } from "./games.js";

/**
 * Computer characters (ADR-025, CC-138). Each game has one character that a player can play at once from the game's
 * page (CC-221). A character is always shown as a computer player, never as a person. Its levels are the picks a
 * player sees, from easiest to hardest, and each names the bot level of `@classicade/games` that plays it. The server
 * checks at start up that every named bot level exists.
 *
 * @typedef {Object} BotLevelPick
 * @property {"easy" | "medium" | "hard"} id   stable, part of the computer player's id, never shown
 * @property {string} name                      what the level button says
 * @property {string} description               one short sentence about how the character plays at this level
 * @property {string} botLevel                  the level id of the game's bot that plays it
 *
 * @typedef {Object} BotCharacter
 * @property {string} id        stable, lowercase, part of the computer player's id
 * @property {string} gameId
 * @property {string} name      shown everywhere the character plays, always with a computer label
 * @property {string} tagline   one short line about how the character plays
 * @property {ReadonlyArray<Readonly<BotLevelPick>>} levels   easiest first, the first is the default
 */

/** The most XP a player earns from games against computer characters in one UTC day (ADR-025). */
export const BOT_DAILY_XP = 100;

/** @type {ReadonlyArray<Readonly<BotCharacter>>} */
export const BOT_CHARACTERS = Object.freeze(
  [
    {
      id: "rocky",
      gameId: GAME_IDS.RPS,
      name: "Rocky",
      tagline: "Rock is life. Or is it?",
      levels: [
        {
          id: "easy",
          name: "Easy",
          description: "Throws at random, so there is no habit to read.",
          botLevel: "random",
        },
        {
          id: "hard",
          name: "Hard",
          description: "Learns your habits and throws what beats them.",
          botLevel: "pattern",
        },
      ],
    },
    {
      id: "pip",
      gameId: GAME_IDS.TIC_TAC_TOE,
      name: "Pip",
      tagline: "Loves a corner.",
      levels: [
        { id: "easy", name: "Easy", description: "Plays anywhere and often misses a win.", botLevel: "easy" },
        {
          id: "medium",
          name: "Medium",
          description: "Takes wins and blocks yours, but a clever trap beats it.",
          botLevel: "medium",
        },
        {
          id: "hard",
          name: "Unbeatable",
          description: "Never loses. A draw is the best you can do.",
          botLevel: "unbeatable",
        },
      ],
    },
    {
      id: "queen-vee",
      gameId: GAME_IDS.CHESS,
      name: "Queen Vee",
      tagline: "Attacks first, asks later.",
      levels: [
        {
          id: "easy",
          name: "Beginner",
          description: "Knows how the pieces move, and blunders often.",
          botLevel: "beginner",
        },
        {
          id: "medium",
          name: "Club player",
          description: "Plays sensible moves and spots short tactics.",
          botLevel: "club",
        },
        {
          id: "hard",
          name: "Strong",
          description: "Looks several moves ahead and punishes mistakes.",
          botLevel: "strong",
        },
      ],
    },
  ].map((character) =>
    Object.freeze({
      ...character,
      levels: Object.freeze(character.levels.map((level) => Object.freeze(level))),
    }),
  ),
);

/**
 * The character a game's page offers.
 *
 * @param {string} gameId
 * @returns {Readonly<BotCharacter> | undefined}
 */
export function characterForGame(gameId) {
  return BOT_CHARACTERS.find((character) => character.gameId === gameId);
}
