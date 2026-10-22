import { GAMES, NOT_FOUND_ROUTE, ROUTE_TEMPLATES } from "@classicade/shared";

const SLUGS = new Set(GAMES.map(({ slug }) => slug));
const TEMPLATES = ROUTE_TEMPLATES.map((template) => [template, template.split("/").filter(Boolean)]);
const fixedParts = (parts) => parts.filter((part) => !part.startsWith(":")).length;

/**
 * The screen an address is, as a telemetry route (CC-174, EVENTS.md 1): its template from `paths.js`, with only a
 * game's slug filled in. A room code, a handle, a token or a query never leaves: `/games/chess/rooms/AB2CD3?x=1`
 * is `/games/chess/rooms/:code`. An address no template matches is `not_found`.
 *
 * @param {string} pathname
 * @returns {string} a TELEMETRY_ROUTES value
 */
export function routeOf(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const matches = TEMPLATES.filter(
    ([, template]) =>
      template.length === parts.length &&
      template.every((part, index) => part.startsWith(":") || part === parts[index]),
  );
  if (matches.length === 0) return NOT_FOUND_ROUTE;
  const [template, templateParts] = matches.reduce((best, next) =>
    fixedParts(next[1]) > fixedParts(best[1]) ? next : best,
  );
  const slugAt = templateParts.indexOf(":slug");
  if (slugAt === -1 || !SLUGS.has(parts[slugAt])) return template;
  return template.replace(":slug", parts[slugAt]);
}
