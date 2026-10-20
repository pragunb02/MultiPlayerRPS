import { matchRoutes } from "react-router";
import { FEEDBACK_DEVICE, gameForSlug, getLeaderboard } from "@classicade/shared";
import { ADMIN_SECTIONS, LEGACY_ROUTES, ROUTES } from "../../app/paths.js";

/**
 * The context a feedback item carries, worked out in the page (CC-290, ADR-059). Each part answers one question the
 * owner has about a bug report and nothing more: which screen, which build, which kind of device.
 */

/** Every page's route, as a pattern with a leading slash. An address with a dot (an old file name) only redirects. */
const PATTERNS = Object.freeze(
  ["/", ...Object.values(ROUTES), ...Object.values(LEGACY_ROUTES)]
    .map((route) => (route.startsWith("/") ? route : `/${route}`))
    .filter((route) => !route.includes(".")),
);
const ROUTE_LIST = PATTERNS.map((path) => ({ path }));

/**
 * The URL parts that may stay as they are, because each names one of a fixed list the site itself publishes: a game,
 * a board, a console section. Anything else in a URL (a room code, a name) becomes its placeholder.
 */
const KEPT_PARAMS = Object.freeze({
  slug: (value) => (gameForSlug(value) === undefined ? undefined : value),
  board: (value) => getLeaderboard(value)?.id,
  section: (value) => (ADMIN_SECTIONS.includes(value) ? value : undefined),
});

/**
 * The page a feedback item is about, as its route pattern: `/games/chess/rooms/:code`, never the code, a name, the
 * query or the hash. An address that is no page of the site is `/*`, since what someone typed there could be anything.
 *
 * @param {string} pathname  the address's path, without query or hash
 * @returns {string}
 */
export function feedbackPage(pathname) {
  const matched = matchRoutes(ROUTE_LIST, pathname);
  if (matched === null) return "/*";
  const { route, params } = matched[0];
  return route.path.replace(/:([a-z]+)/gi, (placeholder, name) => {
    const keep = KEPT_PARAMS[name];
    return (keep && keep(String(params[name]).toLowerCase())) ?? placeholder;
  });
}

/** Below this short side a touch screen is a phone, and below the next one a tablet. */
const PHONE_BELOW = 600;
const TABLET_BELOW = 1100;

/**
 * A coarse class of device: three values, so it says whether a bug is a phone layout bug and cannot single anyone out.
 * Never a user agent or a screen size.
 *
 * @param {{ shortSide: number, coarsePointer: boolean }} screenInfo  the screen's shorter side in CSS pixels, and
 *   whether the main pointer is a finger
 * @returns {string} a FEEDBACK_DEVICE value
 */
export function deviceClass({ shortSide, coarsePointer }) {
  if (!coarsePointer || shortSide >= TABLET_BELOW) return FEEDBACK_DEVICE.DESKTOP;
  return shortSide < PHONE_BELOW ? FEEDBACK_DEVICE.PHONE : FEEDBACK_DEVICE.TABLET;
}

/**
 * This browser's device class.
 *
 * @param {Pick<Window, "screen" | "matchMedia">} browser
 */
export const currentDevice = (browser) =>
  deviceClass({
    shortSide: Math.min(browser.screen.width, browser.screen.height),
    coarsePointer: browser.matchMedia("(pointer: coarse)").matches,
  });
