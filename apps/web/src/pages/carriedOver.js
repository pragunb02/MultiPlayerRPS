const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The welcome after signing up or logging in from a guest session whose games moved to the account (CC-032);
 * empty when nothing was played as a guest.
 *
 * @param {{ xp: number, matchesPlayed: number, matches: number } | undefined} carriedOver
 * @returns {string}
 */
export function carriedOverMessage(carriedOver) {
  if (carriedOver === undefined || carriedOver.matchesPlayed === 0) {
    return "";
  }
  return `Welcome! We moved ${carriedOver.xp} XP and ${plural(carriedOver.matches, "match", "matches")} from your guest games.`;
}
