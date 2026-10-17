import { assertDefined } from "../utils/assert.js";

const freezeAll = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));

/**
 * The owner console's totals as frozen domain rows (CC-233). The DAO already returns counts only. This layer
 * keeps the domain free of MongoDB and freezes every row, so a metric can never change the data it reads.
 *
 * @param {{ analyticsDao: ReturnType<typeof import("../persistence/analyticsDao.js").createAnalyticsDao> }} deps
 */
export function createAnalyticsAccessor({ analyticsDao }) {
  assertDefined(analyticsDao, "analyticsDao");

  return Object.freeze({
    /** @returns {Promise<ReadonlyArray<import("../domain/analytics/metrics.js").PlayerActivity>>} */
    async listPlayerActivity() {
      const players = await analyticsDao.listPlayerActivity();
      return Object.freeze(players.map(({ kind, days }) => Object.freeze({ kind, days: freezeAll(days) })));
    },

    /** @param {{ from: Date, to: Date }} moments */
    async getMatchFacts(moments) {
      const facts = await analyticsDao.getMatchFacts(moments);
      return Object.freeze({
        byDayGame: freezeAll(facts.byDayGame),
        byHour: freezeAll(facts.byHour),
        mix: freezeAll(facts.mix),
        durations: freezeAll(facts.durations),
        rooms: freezeAll(facts.rooms),
        judgedSeats: facts.judgedSeats,
        notCounted: freezeAll(facts.notCounted),
      });
    },

    /** @param {{ from: Date, to: Date }} moments */
    async listSignups(moments) {
      const { transfers, accounts } = await analyticsDao.listSignups(moments);
      return Object.freeze({ transfers: freezeAll(transfers), accounts: freezeAll(accounts) });
    },

    /** @param {{ from: Date, to: Date }} moments */
    listAchievementUnlocks: async (moments) => freezeAll(await analyticsDao.listAchievementUnlocks(moments)),

    /** @param {{ from: Date, to: Date }} moments */
    listQuestCompletions: async (moments) => freezeAll(await analyticsDao.listQuestCompletions(moments)),

    /** @param {{ periods: string[] }} query */
    listLeaderboardSizes: async (query) => freezeAll(await analyticsDao.listLeaderboardSizes(query)),
  });
}
