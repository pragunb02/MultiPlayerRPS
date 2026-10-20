import { GAMES } from "../games.js";

/**
 * The screens and API routes a telemetry event may name (CC-174, EVENTS.md 3.1 and 3.5). Each is a template, never
 * a real address, so no room code, handle, token or id can be sent: the browser turns its address into one of these
 * and the server keeps only values on these lists.
 */

/** The page an address no route matched. */
export const NOT_FOUND_ROUTE = "not_found";
/** An API address no template matched. */
export const OTHER_ENDPOINT = "other";

/**
 * Every screen of `apps/web/src/app/paths.js` as a template with a leading slash, the old addresses that redirect
 * included. A web test fails when a route there has no template here.
 */
export const ROUTE_TEMPLATES = Object.freeze([
  "/",
  "/games/:slug",
  "/games/:slug/rooms/:code",
  "/games/:slug/pass-and-play",
  "/login",
  "/signup",
  "/profile",
  "/players/:handle",
  "/friends",
  "/friends/add/:token",
  "/daily/:kind",
  "/leaderboards",
  "/leaderboards/:board",
  "/privacy",
  "/terms",
  "/admin",
  "/admin/:section",
  "/admin/feedback",
  "/admin/ages",
  "/admin/flags",
  "/play/:slug",
  "/room/:code",
]);

/**
 * The value `route` may take: each template, and each template with `:slug` filled with a game's slug (EVENTS.md
 * "plus `:slug` filled with the game slug"), and NOT_FOUND_ROUTE.
 */
export const TELEMETRY_ROUTES = Object.freeze([
  ...ROUTE_TEMPLATES.flatMap((template) =>
    template.includes(":slug")
      ? [template, ...GAMES.map(({ slug }) => template.replace(":slug", slug))]
      : [template],
  ),
  NOT_FOUND_ROUTE,
]);

/** The API routes the web app calls, as templates under `/api`. A call to any other address is OTHER_ENDPOINT. */
export const API_ENDPOINTS = Object.freeze([
  "/api/session",
  "/api/session/guest",
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/password",
  "/api/auth/sign-out-others",
  "/api/account",
  "/api/account/birth-year",
  "/api/account/delete",
  "/api/account/export",
  "/api/games",
  "/api/achievements",
  "/api/streaks",
  "/api/quests",
  "/api/progress",
  "/api/safety",
  "/api/profile",
  "/api/profile/avatar",
  "/api/profile/visibility",
  "/api/profiles/:handle",
  "/api/matches",
  "/api/matches/:matchId",
  "/api/blocks",
  "/api/blocks/:blockId",
  "/api/friends",
  "/api/friends/settings",
  "/api/friends/requests",
  "/api/friends/requests/:requestId",
  "/api/friends/links",
  "/api/friends/links/:token",
  "/api/friends/:handle",
  "/api/daily/:kind",
  "/api/leaderboards",
  "/api/leaderboards/:board",
  "/api/feedback",
  "/api/feedback/form",
  "/api/flags",
  "/api/flags/:name/success",
  "/api/admin/analytics",
  "/api/admin/feedback",
  "/api/admin/feedback/:feedbackId",
  "/api/admin/flags",
  "/api/admin/flags/:name",
  "/api/admin/accounts/birth-year",
]);

const segmentsOf = (path) => path.split("/").filter((segment) => segment !== "");
const TEMPLATE_SEGMENTS = API_ENDPOINTS.map((template) => [template, segmentsOf(template)]);
const fixedCount = (segments) => segments.filter((segment) => !segment.startsWith(":")).length;

/**
 * The API template an address matches, the one with the most fixed words when several do (so
 * `/api/friends/requests` is not `/api/friends/:handle`). The query is ignored.
 *
 * @param {string} path  such as `/api/matches/abc?x=1`
 * @returns {string} an API_ENDPOINTS value, or OTHER_ENDPOINT
 */
export function endpointOf(path) {
  const segments = segmentsOf(String(path).split(/[?#]/)[0]);
  const matches = TEMPLATE_SEGMENTS.filter(
    ([, template]) =>
      template.length === segments.length &&
      template.every((part, index) => part.startsWith(":") || part === segments[index]),
  );
  if (matches.length === 0) return OTHER_ENDPOINT;
  return matches.reduce((best, next) => (fixedCount(next[1]) > fixedCount(best[1]) ? next : best))[0];
}
