/**
 * The word lists behind the public name rules in `publicName.js` (CC-119, SEC-18).
 *
 * How to change a list:
 * 1. Write every entry in lowercase letters only, with no digits, spaces or underscores. The checker turns
 *    leetspeak and repeated letters into plain letters before it compares, so "fuuuck" and "5hit" need no entry.
 * 2. Put a short or ambiguous word in a "whole word" list. It then only matches a whole name or a whole part of a
 *    name (parts are split at underscores, hyphens and capital letters), so "Dickens" and "Assassin" stay allowed.
 * 3. Put a long word that never hides inside an innocent word in an "anywhere" list.
 * 4. When an innocent word contains an "anywhere" entry, add it to the matching allowlist and add a test.
 * 5. Add a test for the new entry in `publicName.test.js`, and one for a real name that must still pass.
 *
 * The lists are kept small on purpose. They catch the obvious cases. Reports and moderation (CC-044) handle the
 * rest. Some words are left out on purpose because they are also ordinary names, for example Randi, Lund and Lauda.
 * Players never see these lists. The sign-up form only says that a name is reserved or that they should pick
 * another one.
 */

/** Names that make a player look like staff or the company. Matched as a whole name or a whole part of one. */
export const STAFF_WORDS = Object.freeze([
  "admin",
  "administrator",
  "mod",
  "moderator",
  "support",
  "help",
  "staff",
  "official",
  "system",
  "root",
  "guest",
]);

/** Brand and staff words that are reserved even inside a longer name, for example "xXClassiCadeXx". */
export const STAFF_WORDS_ANYWHERE = Object.freeze(["classicade", "nocapgaming", "admin", "moderator"]);

/** Innocent words that contain a word from `STAFF_WORDS_ANYWHERE`. */
export const STAFF_ALLOWLIST = Object.freeze(["badminton"]);

/** Words kept for the coming bot players, so a person cannot pass as a bot. Matched as a whole part of a name. */
export const BOT_WORDS = Object.freeze(["bot", "bots", "robot", "cpu", "computer", "npc"]);

/** Bot words that are reserved inside a longer name too, for example "EasyCPU". */
export const BOT_WORDS_ANYWHERE = Object.freeze(["cpu", "computer"]);

/** Bot words that are reserved at the end of a longer name, for example "chessbot". */
export const BOT_WORD_ENDINGS = Object.freeze(["bot", "bots"]);

/** Innocent names that end like a bot name. */
export const BOT_ALLOWLIST = Object.freeze(["abbot", "abbots", "talbot", "sabot", "cabot"]);

/** Offensive words that are short or that hide inside ordinary words. Matched as a whole part of a name. */
export const BLOCKED_WHOLE_WORDS = Object.freeze([
  "anal",
  "ass",
  "boob",
  "boobs",
  "chink",
  "cock",
  "coon",
  "cuck",
  "cum",
  "dick",
  "dyke",
  "fag",
  "gandu",
  "homo",
  "kys",
  "nazi",
  "paki",
  "prick",
  "pussy",
  "rape",
  "rapist",
  "sex",
  "spic",
  "tit",
  "tits",
  "twat",
  "wank",
]);

/** Offensive words that are blocked anywhere in a name. */
export const BLOCKED_ANYWHERE = Object.freeze([
  "asshole",
  "bastard",
  "behenchod",
  "bhenchod",
  "bhosdi",
  "bitch",
  "chutiya",
  "cunt",
  "faggot",
  "fuck",
  "hitler",
  "jizz",
  "madarchod",
  "nigga",
  "nigger",
  "penis",
  "porn",
  "retard",
  "shit",
  "slut",
  "vagina",
  "wanker",
  "whore",
]);

/** Innocent words and names that contain a word from `BLOCKED_ANYWHERE`. */
export const BLOCKED_ALLOWLIST = Object.freeze([
  "matsushita",
  "niggard",
  "penistone",
  "retardant",
  "scunthorpe",
  "shiitake",
  "shitake",
  "snigger",
]);
