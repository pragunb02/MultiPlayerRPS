/**
 * The header's two breakpoints (CC-324, ADR-076 amended). Under 64rem (1024 px) the header is compact: one row with
 * the brand, the inbox and a Menu button, and the rest in the grouped menu. Under 40rem (640 px) the two game links
 * leave the row too, into the menu's Play group. At 64rem and over everything sits in one row.
 */
export const HEADER_WIDE = "(min-width: 64rem)";
export const HEADER_ROW_LINKS = "(min-width: 40rem)";

/** The parts of the site the header marks as the current one. */
export const SECTIONS = Object.freeze({
  GAMES: "games",
  LEADERBOARDS: "leaderboards",
  FRIENDS: "friends",
  PROFILE: "profile",
  ADMIN: "admin",
});

/**
 * Which header item a page belongs to, so its link shows as the current page wherever the player is inside it:
 * every board (`/leaderboards/weekly`, a game's board) is under Leaderboards, every lobby, room and daily puzzle is
 * under Games. A page outside them (a public profile, the legal pages) marks nothing.
 *
 * @param {string} pathname
 * @returns {string | undefined} one of SECTIONS
 */
export function sectionOf(pathname) {
  const first = pathname.split("/")[1] ?? "";
  switch (first) {
    case "":
    case "games":
    case "daily":
    case "challenge":
      return SECTIONS.GAMES;
    case "leaderboards":
      return SECTIONS.LEADERBOARDS;
    case "friends":
      return SECTIONS.FRIENDS;
    case "profile":
      return SECTIONS.PROFILE;
    case "admin":
      return SECTIONS.ADMIN;
    default:
      return undefined;
  }
}
