/** The facts of a range with no matches, as the MongoDB DAO answers them. */
export const NO_MATCH_FACTS = Object.freeze({
  byDayGame: [],
  byHour: [],
  mix: [],
  durations: [],
  rooms: [],
  judgedSeats: 0,
  notCounted: [],
});

/**
 * A stand-in for the owner console's DAO (persistence/analyticsDao.js) on a site where nothing has happened yet:
 * every read is empty. `analyticsDao.integration.test.js` checks that the MongoDB DAO answers exactly the same on
 * an empty database, so this double cannot drift from it. A test may pass its own answers for any read.
 *
 * @param {Partial<ReturnType<typeof import("../persistence/analyticsDao.js").createAnalyticsDao>>} [reads]
 */
export function createEmptyAnalyticsDao(reads = {}) {
  return Object.freeze({
    listPlayerActivity: async () => [],
    getMatchFacts: async () => ({ ...NO_MATCH_FACTS }),
    listSignups: async () => ({ transfers: [], accounts: [] }),
    listAchievementUnlocks: async () => [],
    listQuestCompletions: async () => [],
    listLeaderboardSizes: async () => [],
    ...reads,
  });
}
