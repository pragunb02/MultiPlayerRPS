import { getGame, SITE_NAME } from "@classicade/shared";

/**
 * The words a player shares: an invite to a room, or a game's result (CC-217). Every line is here, in one place,
 * so the Hinglish string catalogue (CC-218) can take them over later. The owner's Hinglish drafts wait in
 * docs/tickets/CC-217.md until the owner approves them.
 *
 * Nothing here takes a name. The result is told the way Wordle tells it, in the text, with "I" for the player and
 * only a computer character's name for the opponent. A person's name never appears, whatever their age, and never
 * a room code, an id or an email (ADR-028.7).
 */

/** The outcomes a result text can tell. `neutral` is a game with no result to tell, such as an aborted one. */
export const RESULT_OUTCOMES = Object.freeze(["win", "loss", "draw", "neutral"]);

/** The line under every shared text. */
const FREE_LINE = "Free, no login needed.";

const NEUTRAL_UNKNOWN_GAME = `🎮 Come and play with me on ${SITE_NAME}.`;

/** One function per outcome. `game` is the game's name, `character` a computer character's name or "". */
const RESULT_LINES = Object.freeze({
  win: ({ game, character, score, forfeit }) => {
    if (character !== "") {
      return `🏆 I beat ${character}${score ? ` ${score}` : ""} at ${game} on ${SITE_NAME}. Can you beat ${character}?`;
    }
    if (score !== "") {
      return `🏆 I won ${score} at ${game} on ${SITE_NAME}. Your turn!`;
    }
    return `🏆 I won a game of ${game} on ${SITE_NAME}${forfeit ? " (my opponent left)" : ""}. Your turn!`;
  },
  loss: ({ game, character }) =>
    character === ""
      ? `🎯 I played ${game} on ${SITE_NAME} and lost. Can you do better?`
      : `🎯 ${character} beat me at ${game} on ${SITE_NAME}. Can you beat ${character}?`,
  draw: ({ game, character }) =>
    character === ""
      ? `🤝 A draw at ${game} on ${SITE_NAME}. Can you win it?`
      : `🤝 A draw with ${character} at ${game} on ${SITE_NAME}. Can you beat ${character}?`,
  neutral: ({ game }) => `🎮 Come and play ${game} with me on ${SITE_NAME}.`,
});

/**
 * The text of a result share, one line.
 *
 * @param {{ gameId: string, outcome: string, character: string, score: string, forfeit: boolean }} result
 *   outcome: one of RESULT_OUTCOMES, from the player's side. character: the computer character played, or "" for a
 *   person. score: the series score such as "2-1", or "". forfeit: the opponent left
 * @returns {string}
 * @throws {Error} for an outcome that has no words
 */
export function resultText({ gameId, outcome, character, score, forfeit }) {
  if (!Object.hasOwn(RESULT_LINES, outcome)) {
    throw new Error(`No share text for the outcome ${outcome}`);
  }
  const game = getGame(gameId)?.name;
  if (game === undefined) {
    return NEUTRAL_UNKNOWN_GAME;
  }
  return RESULT_LINES[outcome]({ game, character, score, forfeit });
}

/**
 * The text of a room invite, which names the game and the room's code.
 *
 * @param {{ gameId: string, code: string }} room
 */
export function inviteText({ gameId, code }) {
  const game = getGame(gameId)?.name ?? "a game";
  return `Play ${game} with me on ${SITE_NAME} — room ${code}`;
}

/**
 * The text with the free line under it, for a share sheet that takes the link apart.
 *
 * @param {string} text
 */
export const withFreeLine = (text) => `${text}\n${FREE_LINE}`;

/**
 * The whole message as one piece of text: the text, the free line and the link, each on its own line.
 *
 * @param {{ text: string, url: string }} share
 */
export const shareMessage = ({ text, url }) => `${withFreeLine(text)}\n${url}`;

/**
 * WhatsApp's click to chat link: it opens WhatsApp with the message and lets the player pick the chat. Nothing
 * of WhatsApp's runs on our page.
 *
 * @param {string} message
 */
export const whatsappUrl = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;
