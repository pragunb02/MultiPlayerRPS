import {
  DEFAULT_LEADERBOARD_ID,
  gameForSlug,
  getGame,
  isShareChannel,
  SHARE_CHANNEL_PARAM,
} from "@classicade/shared";

/**
 * Every URL of the app, in one place (ADR-011). Pages and components build links with `paths.*` and never write
 * URL strings themselves, so a URL changes here or nowhere.
 *
 *   /                                  home: what ClassiCade is + the game catalog
 *   /games/:slug                       a game's lobby: start a room or join one by code
 *   /games/:slug/rooms/:code           a room (code upper-case); the invite link
 *   /games/:slug/pass-and-play         two people on one phone, nothing sent or kept (CC-223)
 *   /login?next=…  /signup?next=…      account pages; `next` = where to return afterwards
 *   /profile                           your progress and match history (guests and accounts)
 *   /players/:handle                   a player's public profile, by its random handle (CC-034), never by id or name
 *   /daily/:kind                       today's daily puzzle of a kind, such as /daily/chess (CC-144)
 *   /leaderboards/:board               a leaderboard (`overall`, `weekly`, a game's slug); /leaderboards → overall
 *   /privacy  /terms                   the privacy policy and the terms of use
 *   /admin  /admin/:section?from=…&to=…&bucket=…   the owner console (CC-233), not found for anyone but an admin
 *   /admin/feedback?type=…&status=…    the console's feedback inbox (CC-290)
 *   /admin/flags                       the console's feature flags (CC-312)
 *
 * Each page renders only at its canonical URL and replaces any other spelling of it (old URLs, ids instead of
 * slugs, lower-case room codes), so one screen always has exactly one URL.
 *
 * A link our share buttons hand out ends in `?via=wa`, `share` or `copy` (CC-279, `withShareChannel` below). The
 * page that opens it removes the marker before the router reads the address (`landing.js`).
 */
export const ROUTES = Object.freeze({
  GAME: "games/:slug",
  ROOM: "games/:slug/rooms/:code",
  PASS_AND_PLAY: "games/:slug/pass-and-play",
  LOGIN: "login",
  SIGNUP: "signup",
  PROFILE: "profile",
  PLAYER: "players/:handle",
  DAILY: "daily/:kind",
  LEADERBOARDS: "leaderboards",
  LEADERBOARD: "leaderboards/:board",
  PRIVACY: "privacy",
  TERMS: "terms",
  ADMIN: "admin",
  ADMIN_SECTION: "admin/:section",
  ADMIN_FEEDBACK: "admin/feedback",
  ADMIN_FLAGS: "admin/flags",
});

/** The owner console's pages after its overview, in tab order (CC-233). Each is the URL segment after /admin. */
export const ADMIN_SECTIONS = Object.freeze([
  "statuses",
  "players",
  "games",
  "retention",
  "conversion",
  "engagement",
]);

/** The owner console's range in the address, and the feedback inbox's filters. */
const RANGE_KEYS = Object.freeze(["from", "to", "bucket"]);
const FEEDBACK_FILTER_KEYS = Object.freeze(["type", "status"]);

/** URLs that were public once and must keep working (they redirect to the canonical URL). */
export const LEGACY_ROUTES = Object.freeze({
  /** first React app (CC-022…CC-030): /play/rps, /play/tictactoe, /play/chess */
  GAME: "play/:slug",
  /** first React app: /room/AB2CD3 (game unknown until the room is joined) */
  ROOM: "room/:code",
  /** legacy app (until CC-029) */
  PROFILE: "u/:username/userprofile",
  AUTH: "login-signup.html",
});

const AUTH_PATHS = Object.freeze(["/login", "/signup"]);

/** Room codes are upper-case; links and typed codes may not be. */
export const normaliseRoomCode = (code) => String(code).trim().toUpperCase();

/** The game a URL segment names (its slug, or a slug or id it had before). Shared with the server. */
export { gameForSlug };

/**
 * A game's URL segment. A game the server knows but this build doesn't (a deploy in progress) keeps its id, so the
 * link still leads to a clear "not found" instead of breaking the page.
 */
const slugOf = (gameId) => getGame(gameId)?.slug ?? encodeURIComponent(gameId);

/**
 * Where to send someone after logging in or signing up: a same-site path, never another site, never back to an
 * account page (that would loop). Anything else means home.
 *
 * @param {string | null | undefined} next
 */
export function safeNext(next) {
  const path = String(next ?? "");
  const isSameSite = path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
  const isAuthPage = AUTH_PATHS.some(
    (auth) => path === auth || path.startsWith(`${auth}?`) || path.startsWith(`${auth}/`),
  );
  return isSameSite && !isAuthPage ? path : "/";
}

const withNext = (path, next) => {
  const target = safeNext(next);
  return target === "/" ? path : `${path}?next=${encodeURIComponent(target)}`;
};

/**
 * The `next` for account links shown on a page: the page itself, or — on the account pages — the `next` they
 * already carry, so switching between log in and sign up never nests `next` inside `next`.
 *
 * @param {{ pathname: string, search: string }} location
 */
export function returnPathFor({ pathname, search }) {
  if (AUTH_PATHS.includes(pathname)) {
    return safeNext(new URLSearchParams(search).get("next"));
  }
  return `${pathname}${search}`;
}

// A room's page, canonical (`/games/:slug/rooms/:code`) or from the first React app (`/room/:code`).
const ROOM_PAGE = /^\/(?:games\/[^/]+\/rooms|room)\/([^/?#]+)\/?$/;

/**
 * Whether going to `path` brings the player back to room `code`: its own page under any spelling, or logging in
 * or signing up with `next` pointing at it. A seat in a waiting room is kept for such a trip (CC-112), because the
 * seat follows the player who signs in (CC-083).
 *
 * @param {string} path  a same-site path with its query
 * @param {string} code
 */
export function returnsToRoom(path, code) {
  const url = new URL(path, "https://classicade.invalid");
  const target = AUTH_PATHS.includes(url.pathname)
    ? new URL(safeNext(url.searchParams.get("next")), url).pathname
    : url.pathname;
  const room = ROOM_PAGE.exec(target);
  return room !== null && normaliseRoomCode(decodeURIComponent(room[1])) === normaliseRoomCode(code);
}

export const paths = Object.freeze({
  home: () => "/",
  /** @param {string} gameId */
  game: (gameId) => `/games/${slugOf(gameId)}`,
  /** @param {string} gameId @param {string} code */
  room: (gameId, code) => `/games/${slugOf(gameId)}/rooms/${encodeURIComponent(normaliseRoomCode(code))}`,
  /** @param {string} gameId */
  passAndPlay: (gameId) => `/games/${slugOf(gameId)}/pass-and-play`,
  /** @param {string} [next] */
  login: (next) => withNext("/login", next),
  /** @param {string} [next] */
  signup: (next) => withNext("/signup", next),
  profile: () => "/profile",
  /** @param {string} handle  a profile handle the server gave (CC-034) */
  player: (handle) => `/players/${encodeURIComponent(handle)}`,
  /** @param {string} kind  a DAILY_PUZZLE_KINDS value */
  daily: (kind) => `/daily/${encodeURIComponent(kind)}`,
  /** @param {string} [boardId]  a leaderboard id (default: overall XP) */
  leaderboards: (boardId = DEFAULT_LEADERBOARD_ID) => `/leaderboards/${encodeURIComponent(boardId)}`,
  privacy: () => "/privacy",
  terms: () => "/terms",
  /**
   * The owner console: its overview, or one section, for a range. Without a range it opens on the last 30 days.
   *
   * @param {string} [section]  an ADMIN_SECTIONS value, or omitted for the overview
   * @param {{ from?: string, to?: string, bucket?: string }} [range]
   */
  admin: (section, range = {}) => `/admin${section ? `/${section}` : ""}${queryOf(range, RANGE_KEYS)}`,
  /**
   * The console's feedback inbox (CC-290), with its filters.
   *
   * @param {{ type?: string, status?: string }} [filters]  each left out for all
   */
  adminFeedback: (filters = {}) => `/admin/feedback${queryOf(filters, FEEDBACK_FILTER_KEYS)}`,
  /** The console's feature flags (CC-312). */
  adminFlags: () => "/admin/flags",
});

/**
 * A page's query: the given keys that have a value, in the order given, and nothing else. Every address with a query
 * is written with this, so a key is never misspelled or left in by one page and not another.
 *
 * @param {Record<string, string | undefined>} values
 * @param {ReadonlyArray<string>} keys
 * @returns {string} "" when no key has a value, else "?" and the query
 */
export function queryOf(values, keys) {
  const params = new URLSearchParams(
    keys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]),
  );
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * A link our share buttons hand out, marked with the channel it leaves by (CC-279): `?via=wa`, `share` or `copy`.
 * The marker names the channel only, never the sharer, so a player who opens the link cannot be tied to the one who
 * sent it (ADR-034.1). A channel that is not on the list throws, so a typo fails a test instead of shipping.
 *
 * @param {string} url  an absolute link with no query, built from `paths`
 * @param {string} channel  a `SHARE_CHANNELS` value
 * @returns {string}
 */
export function withShareChannel(url, channel) {
  if (!isShareChannel(channel)) {
    throw new RangeError(`Not a share channel: ${JSON.stringify(channel)}`);
  }
  return `${url}?${new URLSearchParams([[SHARE_CHANNEL_PARAM, channel]])}`;
}
