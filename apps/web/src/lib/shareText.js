import {
  DAILY_PUZZLE_KINDS,
  DAILY_PUZZLE_MARKS,
  DAILY_PUZZLE_STATUS,
  getDailyPuzzle,
  getGame,
  SITE_NAME,
} from "@classicade/shared";

/**
 * The words a player shares: an invite to a room, or a game's result (CC-217). Every line is here, in one place,
 * so the string catalogue (CC-218) can take them over later. Each text is a Hinglish line first and a short English
 * line under it (the owner's choice, ADR-051). The Hinglish lines are the owner's drafts from docs/tickets/CC-217.md.
 * Lines for cases the drafts did not cover are marked below and listed in the ticket for the owner.
 *
 * Nothing here takes a name. The result is told the way Wordle tells it, in the text, with "I" for the player and
 * only a computer character's name for the opponent. A person's name never appears, whatever their age, and never
 * a room code, an id or an email (ADR-028.7).
 */

/** The outcomes a result text can tell. `neutral` is a game with no result to tell, such as an aborted one. */
export const RESULT_OUTCOMES = Object.freeze(["win", "loss", "draw", "neutral"]);

/** The lines under every shared text, Hinglish first. */
const FREE_LINES = "Free hai, login nahi chahiye.\nFree, no login needed.";

/** Two lines, Hinglish first, with the emoji once at the start. */
const lines = (emoji, hinglish, english) => `${emoji} ${hinglish}\n${english}`;

/** One function per outcome. `game` is the game's name, `character` a computer character's name or "". */
const RESULT_LINES = Object.freeze({
  win: ({ game, character, score, forfeit }) => {
    const by = score === "" ? "" : ` ${score}`;
    if (character !== "") {
      return lines(
        "🏆",
        score === ""
          ? `Maine ${character} ko haraya! Tum try karo:`
          : `Maine ${character} ko ${score} se haraya! Tum try karo:`,
        `I beat ${character}${by} at ${game} on ${SITE_NAME}. Can you beat ${character}?`,
      );
    }
    return lines(
      "🏆",
      score === ""
        ? `Maine ${game} jeeta! Ab tumhari baari:`
        : `Maine ${game} jeeta ${score} se! Ab tumhari baari:`,
      score === ""
        ? `I won a game of ${game} on ${SITE_NAME}${forfeit ? " (my opponent left)" : ""}. Your turn!`
        : `I won ${score} at ${game} on ${SITE_NAME}. Your turn!`,
    );
  },
  loss: ({ game, character }) =>
    character === ""
      ? // Not in the owner's drafts (CC-217).
        lines(
          "🎯",
          `Aaj ${game} mein haar mili. Badla loge?`,
          `I played ${game} on ${SITE_NAME} and lost. Can you do better?`,
        )
      : lines(
          "🎯",
          `${game} mein ${character} ne mujhe hara diya. Badla loge?`,
          `${character} beat me at ${game} on ${SITE_NAME}. Can you beat ${character}?`,
        ),
  // Neither draw line is in the owner's drafts (CC-217).
  draw: ({ game, character }) =>
    character === ""
      ? lines(
          "🤝",
          `${game} mein draw raha. Tum jeet ke dikhao:`,
          `A draw at ${game} on ${SITE_NAME}. Can you win it?`,
        )
      : lines(
          "🤝",
          `${game} mein ${character} ke saath draw raha. Tum jeet ke dikhao:`,
          `A draw with ${character} at ${game} on ${SITE_NAME}. Can you beat ${character}?`,
        ),
  // Not in the owner's drafts (CC-217): the invite line, shortened.
  neutral: ({ game }) =>
    lines(
      "🎮",
      `Ek game ho jaaye? ${SITE_NAME} pe ${game} khelo:`,
      `Come and play ${game} with me on ${SITE_NAME}.`,
    ),
});

// Not in the owner's drafts (CC-217): the invite line without a game.
const NEUTRAL_UNKNOWN_GAME = lines(
  "🎮",
  `Ek game ho jaaye? ${SITE_NAME} pe khelo:`,
  `Come and play with me on ${SITE_NAME}.`,
);

/**
 * The text of a result share: a Hinglish line and an English line.
 *
 * @param {{ gameId: string, outcome: string, character: string, score: string, forfeit: boolean }} result
 *   outcome: one of RESULT_OUTCOMES, from the player's side. character: the computer character played, or "" for a
 *   person. score: a score such as "2-1" that the player leads, or "". forfeit: the opponent left
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

/** The share grid's square for each mark: found first time, found after a mistake, where it ended, not reached. */
const GRID_SQUARES = Object.freeze({
  [DAILY_PUZZLE_MARKS.FIRST_TRY]: "🟩",
  [DAILY_PUZZLE_MARKS.AFTER_MISTAKES]: "🟨",
  [DAILY_PUZZLE_MARKS.FAILED]: "🟥",
  [DAILY_PUZZLE_MARKS.NOT_REACHED]: "⬛",
});

/**
 * The lines under a daily puzzle's grid, per kind, solved and failed (CC-144). None of them is in the owner's
 * drafts: they are listed in docs/tickets/CC-144.md for the owner.
 */
const DAILY_LINES = Object.freeze({
  [DAILY_PUZZLE_KINDS.CHESS]: Object.freeze({
    [DAILY_PUZZLE_STATUS.SOLVED]: [
      "Aaj ka chess puzzle solve kar liya! Tum karke dikhao:",
      `I solved today's chess puzzle on ${SITE_NAME}. Can you?`,
    ],
    [DAILY_PUZZLE_STATUS.FAILED]: [
      "Aaj ka chess puzzle mushkil tha. Tum solve karke dikhao:",
      `Today's chess puzzle on ${SITE_NAME} beat me. Can you solve it?`,
    ],
  }),
});

/**
 * The squares of a daily puzzle's grid, one per move to find.
 *
 * @param {ReadonlyArray<string>} grid  DAILY_PUZZLE_MARKS values
 */
export const gridSquares = (grid) => grid.map((mark) => GRID_SQUARES[mark]).join("");

/**
 * The text of a daily puzzle share, the way Wordle shares (CC-144): the puzzle and its number, a grid of squares
 * that tells how it went and never which moves, the hints and the streak, then a Hinglish and an English line. It
 * takes no name, so no guest's or minor's name can be in it (ADR-028.7).
 *
 * @param {{ kind: string, number: number, status: string, grid: ReadonlyArray<string>, hintsTaken: number, streak: number }} puzzle
 *   status: solved or failed. streak: the puzzle's streak now
 * @returns {string}
 * @throws {Error} for a kind or a status that has no words
 */
export function dailyPuzzleText({ kind, number, status, grid, hintsTaken, streak }) {
  const words = DAILY_LINES[kind]?.[status];
  if (words === undefined) {
    throw new Error(`No share text for a ${kind} puzzle that is ${status}`);
  }
  const extras = [hintsTaken > 0 ? `💡${hintsTaken}` : "", streak > 0 ? `🔥${streak}` : ""].filter(Boolean);
  const gridLine = [gridSquares(grid), ...extras].join(" ");
  return `🧩 ${SITE_NAME} ${getDailyPuzzle(kind).name} #${number}\n${gridLine}\n${words.join("\n")}`;
}

/**
 * The text of a room invite: the owner's Hinglish line, then the English one with the room's code.
 *
 * @param {{ gameId: string, code: string }} room
 */
export function inviteText({ gameId, code }) {
  const game = getGame(gameId)?.name;
  const hinglish =
    game === undefined
      ? `Ek game ho jaaye? ${SITE_NAME} pe khelo, link kholo aur seedha khelo:`
      : `Ek game ho jaaye? ${SITE_NAME} pe ${game} khelo, link kholo aur seedha khelo:`;
  return `${hinglish}\nPlay ${game ?? "a game"} with me on ${SITE_NAME} — room ${code}`;
}

/**
 * The text for a "be my friend" link (CC-052), Hinglish first. Like every shared text it names nobody, so a minor's
 * name never travels with their link (ADR-028.7). Not in the owner's drafts: the builder's line for the owner.
 */
export const friendLinkText = () =>
  `${SITE_NAME} pe mere friend bano, phir saath mein khelenge:\nBe my friend on ${SITE_NAME}, then we can play any time:`;

/**
 * The text of a challenge link (CC-139): the Hinglish line, then the English one. It never names the player who
 * sends it, so a forwarded message says nothing about them (ADR-028.7).
 *
 * @param {{ gameId: string }} challenge
 */
export function challengeText({ gameId }) {
  const game = getGame(gameId)?.name ?? "a game";
  return `${game} mein mujhse jeet ke dikhao! Link 24 ghante chalega:\nI challenge you to ${game} on ${SITE_NAME}. The link works for 24 hours`;
}

/**
 * The text with the free lines under it, for a share sheet that takes the link apart.
 *
 * @param {string} text
 */
export const withFreeLine = (text) => `${text}\n${FREE_LINES}`;

/**
 * The whole message as one piece of text: the text, the free lines and the link, each on its own line.
 *
 * @param {{ text: string, url: string }} share
 */
export const shareMessage = ({ text, url }) => `${withFreeLine(text)}\n${url}`;

/**
 * Whether the device's share sheet failed only because the player closed it, which is no error. Any other refusal,
 * such as a browser that does not allow sharing from this page, is a real failure.
 *
 * @param {unknown} error  what `navigator.share` rejected with
 */
export const shareWasCancelled = (error) => error?.name === "AbortError";

/**
 * WhatsApp's click to chat link: it opens WhatsApp with the message and lets the player pick the chat. Nothing
 * of WhatsApp's runs on our page.
 *
 * @param {string} message
 */
export const whatsappUrl = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;
