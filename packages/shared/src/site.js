import { GAMES, getGameBySlug } from "./games.js";
import { getLeaderboard, LEADERBOARDS } from "./leaderboards.js";
import { PREVIEW_IMAGE_FILES } from "./previewImages.js";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./rooms.js";

/**
 * What each public page of the site is called and says about itself (CC-047). The web app shows it in the tab
 * and the page head, and the server writes it into the HTML it sends, because link previews and search crawlers
 * read that HTML without running any script. One description here keeps the two from drifting apart.
 *
 * The URL shapes below are the ones the web app builds in apps/web/src/app/paths.js (ADR-011). A test there
 * checks that every page listed in `PUBLIC_PAGE_PATHS` is a link the app itself makes.
 */

export const SITE_NAME = "ClassiCade";

/**
 * The name of the head tag in which the server tells the web app the site's own address, for the links it shares
 * (CC-217). The server writes it from its settings, never from the request. It is not marked as a server tag, so it
 * stays in the page after the app takes the other server tags out.
 */
export const SITE_ORIGIN_META = "classicade:site-origin";

/** Size of every preview image in /og, the size link previews show best. */
export const PREVIEW_IMAGE = Object.freeze({ width: 1200, height: 630 });

/**
 * How many hex characters of the image's SHA-256 hash its file name carries, such as `chess.1a2b3c4d.jpg`. A
 * changed image gets a new name, because chat apps keep a preview image by its address (CC-217).
 */
export const PREVIEW_IMAGE_HASH_LENGTH = 8;

/** The preview image for pages that are not about one game. */
export const SITE_PREVIEW_IMAGE = PREVIEW_IMAGE_FILES.classicade;

/**
 * The preview images of the first release (CC-047), PNGs over 300 KB that WhatsApp may skip. No page names them
 * any more, but they stay online, because messages sent before still point at them (CC-217).
 */
export const RETIRED_PREVIEW_IMAGES = Object.freeze([
  "/og/classicade.png",
  "/og/rock-paper-scissors.png",
  "/og/tic-tac-toe.png",
  "/og/chess.png",
]);

/**
 * The game's preview image. A test in apps/web/og fails when a game has none.
 *
 * @param {Readonly<import("./games.js").GameInfo>} game
 */
export const gamePreviewImage = (game) => PREVIEW_IMAGE_FILES[game.slug];

// Earlier URL segments for games, from the legacy app (`/games/rockpaperscissors`) and from game ids (`/play/rps`).
const LEGACY_GAME_SLUGS = Object.freeze({
  rockpaperscissors: "rock-paper-scissors",
  rps: "rock-paper-scissors",
  tictactoe: "tic-tac-toe",
});

const ROOM_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * The game a URL segment names: its slug, or a slug or id it had before.
 *
 * @param {string | undefined} segment
 * @returns {Readonly<import("./games.js").GameInfo> | undefined}
 */
export function gameForSlug(segment) {
  const slug = String(segment ?? "").toLowerCase();
  return getGameBySlug(slug) ?? getGameBySlug(LEGACY_GAME_SLUGS[slug] ?? "");
}

/**
 * @typedef {Object} PageInfo
 * @property {boolean} found        false when no page lives at this URL (the server answers 404)
 * @property {string} title         the page's name in a link preview, such as "Join my Chess game on ClassiCade"
 * @property {string} description   one or two plain sentences for search results and previews
 * @property {string} path          the page's own URL path, the one previews and search results should link to
 * @property {boolean} indexable    whether search engines should list it (rooms, accounts and old URLs are not)
 * @property {string} image         path of the preview image
 * @property {string} imageAlt      what the preview image shows, for people who cannot see it
 */

const SITE_IMAGE_ALT = "The ClassiCade arcade: rock paper scissors, tic tac toe and chess pieces";

/** @param {Partial<PageInfo> & Pick<PageInfo, "title" | "description" | "path">} fields */
const page = (fields) =>
  Object.freeze({
    found: true,
    indexable: false,
    image: SITE_PREVIEW_IMAGE,
    imageAlt: SITE_IMAGE_ALT,
    ...fields,
  });

const withGameImage = (game) => ({ image: gamePreviewImage(game), imageAlt: `${game.name} on ${SITE_NAME}` });

const NOT_FOUND = page({
  found: false,
  title: `Page not found · ${SITE_NAME}`,
  description: `That page doesn't exist on ${SITE_NAME}.`,
  path: "/",
});

const HOME = page({
  title: `${SITE_NAME}: classic games with anyone, anywhere`,
  description:
    "Play Rock Paper Scissors, Tic Tac Toe and Chess with a friend in your browser. Free, nothing to install, no account needed.",
  path: "/",
  indexable: true,
});

const lobby = (game, indexable) =>
  page({
    title: `Play ${game.name} with a friend on ${SITE_NAME}`,
    description: `Play ${game.name} online with a friend: start a room, send the link and play in seconds. Free, nothing to install, no account needed.`,
    path: `/games/${game.slug}`,
    indexable,
    ...withGameImage(game),
  });

/** A room's URL names its game, so the preview can say which game without asking whether the room exists. */
const room = (game, code) =>
  game === undefined
    ? page({
        title: `Join my game on ${SITE_NAME}`,
        description: `You're invited to play on ${SITE_NAME}. Open the link to take your seat, no account needed.`,
        path: `/room/${code}`,
      })
    : page({
        title: `Join my ${game.name} game on ${SITE_NAME}`,
        description: `You're invited to a game of ${game.name}. Open the link to take your seat, no account needed.`,
        path: `/games/${game.slug}/rooms/${code}`,
        ...withGameImage(game),
      });

const leaderboard = (board) =>
  page({
    title: `${board.name} leaderboard · ${SITE_NAME}`,
    description: `The top ${SITE_NAME} players on the ${board.name} board. Make an account to get your name on it.`,
    path: `/leaderboards/${board.id}`,
    indexable: true,
  });

/** Pages at one fixed URL, by their lower case path segment. */
const FIXED = Object.freeze({
  privacy: page({
    title: `Privacy policy · ${SITE_NAME}`,
    description: `What ${SITE_NAME} stores about you, why, for how long, and how to have it deleted. One essential cookie, no ads, no trackers.`,
    path: "/privacy",
    indexable: true,
  }),
  terms: page({
    title: `Terms of use · ${SITE_NAME}`,
    description: `The rules for playing on ${SITE_NAME}: fair play, your account, and what we can and cannot promise.`,
    path: "/terms",
    indexable: true,
  }),
  login: page({
    title: `Log in · ${SITE_NAME}`,
    description: `Log in to your ${SITE_NAME} account to keep your level, achievements and match history.`,
    path: "/login",
  }),
  signup: page({
    title: `Sign up · ${SITE_NAME}`,
    description: `Make a free ${SITE_NAME} account to keep your progress on every device and appear on the leaderboards.`,
    path: "/signup",
  }),
  profile: page({
    title: `Your profile · ${SITE_NAME}`,
    description: `Your level, achievements and match history on ${SITE_NAME}.`,
    path: "/profile",
  }),
  "login-signup.html": page({
    title: `Log in · ${SITE_NAME}`,
    description: `Log in to your ${SITE_NAME} account to keep your level, achievements and match history.`,
    path: "/login",
  }),
});

/** URL segments decoded, or undefined when the path is not valid percent encoding. */
function segmentsOf(pathname) {
  try {
    return String(pathname)
      .split("/")
      .filter((segment) => segment !== "")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

const roomCodeOf = (segment) => {
  const code = segment.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : undefined;
};

/** Matches the routes of apps/web/src/app/App.jsx, which ignore letter case in fixed segments, as React Router does. */
function match(segments) {
  if (segments.length === 0) return HOME;
  const [first, ...rest] = segments;
  const head = first.toLowerCase();
  if (rest.length === 0 && Object.hasOwn(FIXED, head)) return FIXED[head];

  if (head === "games" || head === "play") {
    const game = gameForSlug(rest[0]);
    if (rest.length === 1 && game !== undefined) {
      // Only the canonical lobby URL is listed, old and mistyped spellings are sent there by the app.
      return lobby(game, head === "games" && rest[0] === game.slug);
    }
    const isRoom = head === "games" && rest.length === 3 && rest[1].toLowerCase() === "rooms";
    const code = isRoom ? roomCodeOf(rest[2]) : undefined;
    return code === undefined ? NOT_FOUND : room(game, code);
  }
  if (head === "room" && rest.length === 1) {
    const code = roomCodeOf(rest[0]);
    return code === undefined ? NOT_FOUND : room(undefined, code);
  }
  if (head === "leaderboards" && rest.length <= 1) {
    const board = getLeaderboard(rest[0] ?? LEADERBOARDS[0].id);
    return board === undefined ? NOT_FOUND : leaderboard(board);
  }
  if (head === "u" && rest.length === 2 && rest[1].toLowerCase() === "userprofile") return FIXED.profile;
  return NOT_FOUND;
}

/**
 * What the page at a URL path is, for its head tags and its HTTP status.
 *
 * @param {string} pathname  the path part of a URL, still percent encoded
 * @returns {Readonly<PageInfo>}
 */
export function describePage(pathname) {
  const segments = segmentsOf(pathname);
  return segments === undefined ? NOT_FOUND : match(segments);
}

/** Every page search engines should list: home, the game lobbies, the leaderboards and the legal pages. */
export const PUBLIC_PAGE_PATHS = Object.freeze([
  "/",
  ...GAMES.map((game) => `/games/${game.slug}`),
  ...LEADERBOARDS.map((board) => `/leaderboards/${board.id}`),
  "/privacy",
  "/terms",
]);
