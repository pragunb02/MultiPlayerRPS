import { GAMES } from "@classicade/shared";
import {
  BLOCKED_ALLOWLIST,
  BLOCKED_ANYWHERE,
  BLOCKED_WHOLE_WORDS,
  BOT_ALLOWLIST,
  BOT_WORD_ENDINGS,
  BOT_WORDS,
  BOT_WORDS_ANYWHERE,
  STAFF_ALLOWLIST,
  STAFF_WORDS,
  STAFF_WORDS_ANYWHERE,
} from "./nameLists.js";
import { PLAYER_ID_PREFIXES } from "./playerIdShape.js";

// Common leetspeak, so "4dm1n" and "5h1t" are read as the words they spell.
const LEET = Object.freeze({ 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s" });

const lettersOf = (text) => text.replace(/[^a-z]/g, "");

/**
 * Plain lowercase letters, with leetspeak read as letters and everything else dropped.
 * A part made only of digits is a number, not a word, so it reads as nothing.
 */
function plainLetters(text) {
  if (/^[0-9]*$/.test(text)) return "";
  return lettersOf([...text.toLowerCase()].map((char) => LEET[char] ?? char).join(""));
}

/**
 * The ways one piece of a name is read. Digits padding the ends are tried both as leetspeak ("5hit") and as
 * padding that does not count ("Admin_1").
 */
function readingsOf(text) {
  const unpadded = text.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  return [plainLetters(text), plainLetters(unpadded)].filter((reading) => reading !== "");
}

/**
 * The whole name squeezed together (catches "a_d_m_i_n"), plus each part of it. Parts are split at anything
 * that is not a letter, digit or leetspeak symbol, and where a capital letter follows a small one ("BigBoss").
 */
function wholeAndParts(name) {
  const parts = name.split(/[^A-Za-z0-9@$]+|(?<=[a-z])(?=[A-Z])/);
  return {
    whole: readingsOf(name.replace(/[^A-Za-z0-9@$]+/g, "")),
    parts: parts.flatMap(readingsOf),
  };
}

/**
 * A pattern for a listed word that also matches its letters held longer ("fuuuck"). A doubled letter stays at
 * least doubled, so "ass" does not match "as".
 */
function stretchy(word) {
  return word.replace(/(.)\1*/g, (run) => `${run[0]}{${run.length},}`);
}

const exactly = (words) => new RegExp(`^(?:${words.map(stretchy).join("|")})$`);
const anywhere = (words) => new RegExp(words.map(stretchy).join("|"));
const removing = (words) => new RegExp(words.join("|"), "g");

const GAME_WORDS = Object.freeze([
  "ttt",
  ...new Set(GAMES.flatMap((game) => [game.id, game.slug, game.name].map(plainLetters))),
]);

const RULES = Object.freeze({
  blockedWhole: exactly(BLOCKED_WHOLE_WORDS),
  blockedAnywhere: anywhere(BLOCKED_ANYWHERE),
  blockedAllowed: removing(BLOCKED_ALLOWLIST),
  staffAnywhere: new RegExp(STAFF_WORDS_ANYWHERE.join("|")),
  staffAllowed: removing(STAFF_ALLOWLIST),
  botAnywhere: new RegExp(BOT_WORDS_ANYWHERE.join("|")),
  botEnding: new RegExp(`(?:${BOT_WORD_ENDINGS.join("|")})$`),
});

/** Splits off the allowlisted words first, so "Scunthorpe" never reaches the "anywhere" check. */
const containsOutside = (reading, pattern, allowed) =>
  reading.split(allowed).some((piece) => pattern.test(piece));

const looksLikeBot = (reading) =>
  BOT_WORDS.includes(reading) || (RULES.botEnding.test(reading) && !BOT_ALLOWLIST.includes(reading));

/**
 * Whether a public name passes as staff, the company, a bot or a game, for example "Admin_1", "a_d_m_i_n",
 * "ClassiCade_HQ", "ChessBot" or "Tic_Tac_Toe". Case, separators, leetspeak and padding digits do not matter.
 * A name that starts like a player id, such as "user_bob", is reserved too, so a name never looks like an id
 * (CC-304).
 *
 * @param {string} name  a name that already has the right shape (for example a username)
 * @returns {boolean}
 */
export function isReservedName(name) {
  const { whole, parts } = wholeAndParts(name);
  const readings = [...whole, ...parts];
  const lower = name.toLowerCase();
  return (
    PLAYER_ID_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    whole.some((reading) => GAME_WORDS.includes(reading)) ||
    readings.some((reading) => STAFF_WORDS.includes(reading) || looksLikeBot(reading)) ||
    whole.some(
      (reading) =>
        containsOutside(reading, RULES.staffAnywhere, RULES.staffAllowed) || RULES.botAnywhere.test(reading),
    )
  );
}

/**
 * Whether a public name contains a slur or a rude word. Short words count only as a whole part of the name, and
 * allowlisted words are skipped, so real names such as "Dickens", "Assassin" and "Scunthorpe" still pass.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isOffensiveName(name) {
  const { whole, parts } = wholeAndParts(name);
  return (
    [...whole, ...parts].some((reading) => RULES.blockedWhole.test(reading)) ||
    whole.some((reading) => containsOutside(reading, RULES.blockedAnywhere, RULES.blockedAllowed))
  );
}
