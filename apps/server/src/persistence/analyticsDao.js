// Read-only totals for the owner console (CC-233), worked out by MongoDB from collections other DAOs own and
// write: matches, player_transfers, accounts, player_achievements, player_quests and leaderboard_entries. Nothing
// is written here, and no pipeline returns a player id, a name or a room code: ids are grouped on inside the
// database and only counts and kinds come out. The indexes these reads use are declared by the DAOs that own each
// collection, because their syncIndexes would drop any index they do not know about.

/** The zone the days and hours are grouped in. Must match utils/indiaTime.js. */
const TIME_ZONE = "Asia/Kolkata";
const BOT_ID = /^bot_/;
const GUEST_ID = /^guest_/;
const ACCOUNT_ID = /^user_/;

const dayOf = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: TIME_ZONE } });
const countMatching = (regex) => ({
  $size: { $filter: { input: "$ids", cond: { $regexMatch: { input: "$$this", regex } } } },
});
const betweenDates = (field, { from, to }) => ({ [field]: { $gte: from, $lt: to } });
const AGGREGATE_OPTIONS = Object.freeze({ allowDiskUse: true });

/**
 * @typedef {{ from: Date, to: Date }} Moments  the start, included, and the end, not included
 */

/**
 * @param {{ connection: import("mongoose").Connection }} deps
 */
export function createAnalyticsDao({ connection }) {
  const collection = (name) => connection.collection(name);
  const aggregate = (name, pipeline) => collection(name).aggregate(pipeline, AGGREGATE_OPTIONS).toArray();

  return Object.freeze({
    /**
     * Every player who ever finished a match, without their id: their kind (the id's prefix, such as "guest")
     * and, for each India day they played, how many matches they finished, how many counted for them under fair
     * play, and how many had another person in them. Bots are left out as players. Reads every match, so the
     * caller caches the answer.
     *
     * @returns {Promise<Array<{ kind: string, days: Array<{ day: string, matches: number, counted: number, vsPerson: number }> }>>}
     *   days oldest first
     */
    listPlayerActivity: () =>
      aggregate("matches", [
        {
          $project: {
            _id: 0,
            endedAt: 1,
            ids: "$players.playerId",
            notCounted: { $ifNull: ["$credit.notCounted.playerId", []] },
          },
        },
        { $addFields: { people: { $subtract: [{ $size: "$ids" }, countMatching(BOT_ID)] } } },
        { $unwind: "$ids" },
        { $match: { ids: { $not: BOT_ID } } },
        {
          $group: {
            _id: { player: "$ids", day: dayOf("$endedAt") },
            matches: { $sum: 1 },
            counted: { $sum: { $cond: [{ $in: ["$ids", "$notCounted"] }, 0, 1] } },
            vsPerson: { $sum: { $cond: [{ $gte: ["$people", 2] }, 1, 0] } },
          },
        },
        { $sort: { "_id.day": 1 } },
        {
          $group: {
            _id: "$_id.player",
            days: {
              $push: { day: "$_id.day", matches: "$matches", counted: "$counted", vsPerson: "$vsPerson" },
            },
          },
        },
        { $project: { _id: 0, kind: { $arrayElemAt: [{ $split: ["$_id", "_"] }, 0] }, days: 1 } },
      ]),

    /**
     * Totals of the matches that ended in a range: per India day and game, per India weekday and hour, by who
     * played (accounts, guests, both, with a bot), by length in whole seconds, rematches per game (a later match
     * in the same room), and the player results fair play did not count.
     *
     * @param {Moments} moments
     */
    async getMatchFacts(moments) {
      const [facts] = await aggregate("matches", [
        { $match: betweenDates("endedAt", moments) },
        {
          $project: {
            _id: 0,
            gameId: 1,
            roomCode: 1,
            startedAt: 1,
            endedAt: 1,
            ids: "$players.playerId",
            judged: { $cond: [{ $ifNull: ["$credit", false] }, true, false] },
            notCounted: { $ifNull: ["$credit.notCounted", []] },
          },
        },
        {
          $facet: {
            byDayGame: [
              { $group: { _id: { day: dayOf("$endedAt"), gameId: "$gameId" }, matches: { $sum: 1 } } },
              { $project: { _id: 0, day: "$_id.day", gameId: "$_id.gameId", matches: 1 } },
            ],
            byHour: [
              {
                $group: {
                  _id: {
                    weekday: { $isoDayOfWeek: { date: "$endedAt", timezone: TIME_ZONE } },
                    hour: { $hour: { date: "$endedAt", timezone: TIME_ZONE } },
                  },
                  matches: { $sum: 1 },
                },
              },
              { $project: { _id: 0, weekday: "$_id.weekday", hour: "$_id.hour", matches: 1 } },
            ],
            mix: [
              {
                $project: {
                  guests: countMatching(GUEST_ID),
                  accounts: countMatching(ACCOUNT_ID),
                  bots: countMatching(BOT_ID),
                },
              },
              {
                $group: {
                  _id: {
                    mix: {
                      $switch: {
                        branches: [
                          {
                            case: { $and: [{ $gt: ["$guests", 0] }, { $gt: ["$accounts", 0] }] },
                            then: "mixed",
                          },
                          { case: { $gt: ["$guests", 0] }, then: "guests" },
                          { case: { $gt: ["$accounts", 0] }, then: "accounts" },
                        ],
                        default: "other",
                      },
                    },
                    withBot: { $gt: ["$bots", 0] },
                  },
                  matches: { $sum: 1 },
                },
              },
              { $project: { _id: 0, mix: "$_id.mix", withBot: "$_id.withBot", matches: 1 } },
            ],
            durations: [
              {
                $group: {
                  _id: {
                    gameId: "$gameId",
                    seconds: { $round: [{ $divide: [{ $subtract: ["$endedAt", "$startedAt"] }, 1000] }, 0] },
                  },
                  matches: { $sum: 1 },
                },
              },
              { $project: { _id: 0, gameId: "$_id.gameId", seconds: "$_id.seconds", matches: 1 } },
            ],
            rooms: [
              { $group: { _id: { roomCode: "$roomCode", gameId: "$gameId" }, matches: { $sum: 1 } } },
              {
                $group: {
                  _id: "$_id.gameId",
                  matches: { $sum: "$matches" },
                  rematches: { $sum: { $subtract: ["$matches", 1] } },
                },
              },
              { $project: { _id: 0, gameId: "$_id", matches: 1, rematches: 1 } },
            ],
            judgedSeats: [
              { $match: { judged: true } },
              { $group: { _id: null, seats: { $sum: { $size: "$ids" } } } },
            ],
            notCounted: [
              { $unwind: "$notCounted" },
              { $group: { _id: "$notCounted.reason", seats: { $sum: 1 } } },
              { $project: { _id: 0, reason: "$_id", seats: 1 } },
            ],
          },
        },
      ]);
      return { ...facts, judgedSeats: facts.judgedSeats[0]?.seats ?? 0 };
    },

    /**
     * Guest transfers started in a range per India day, with how many of those guests had finished a match, and
     * accounts created per India day.
     *
     * @param {Moments} moments
     */
    async listSignups(moments) {
      const [transfers, accounts] = await Promise.all([
        aggregate("player_transfers", [
          { $match: betweenDates("createdAt", moments) },
          {
            $group: {
              _id: dayOf("$createdAt"),
              transfers: { $sum: 1 },
              withMatches: { $sum: { $cond: [{ $gt: ["$carriedOver.matches", 0] }, 1, 0] } },
            },
          },
          { $project: { _id: 0, day: "$_id", transfers: 1, withMatches: 1 } },
        ]),
        aggregate("accounts", [
          { $match: betweenDates("createdAt", moments) },
          { $group: { _id: dayOf("$createdAt"), accounts: { $sum: 1 } } },
          { $project: { _id: 0, day: "$_id", accounts: 1 } },
        ]),
      ]);
      return { transfers, accounts };
    },

    /**
     * How many players unlocked each achievement in a range.
     *
     * @param {Moments} moments
     * @returns {Promise<Array<{ achievementId: string, players: number }>>}
     */
    listAchievementUnlocks: (moments) =>
      aggregate("player_achievements", [
        { $match: betweenDates("unlockedAt", moments) },
        { $group: { _id: "$achievementId", players: { $sum: 1 } } },
        { $project: { _id: 0, achievementId: "$_id", players: 1 } },
      ]),

    /**
     * How many daily quests of each kind were completed in a range. Quest days are kept for 8 days only, so
     * older completions are gone (CC-089).
     *
     * @param {Moments} moments
     * @returns {Promise<Array<{ questId: string, completions: number }>>}
     */
    listQuestCompletions: ({ from, to }) =>
      aggregate("player_quests", [
        { $match: { items: { $elemMatch: { completedAt: { $gte: from.getTime(), $lt: to.getTime() } } } } },
        { $unwind: "$items" },
        { $match: { "items.completedAt": { $gte: from.getTime(), $lt: to.getTime() } } },
        { $group: { _id: "$items.id", completions: { $sum: 1 } } },
        { $project: { _id: 0, questId: "$_id", completions: 1 } },
      ]),

    /**
     * How many entries each leaderboard has in the given periods ("all", or a week such as "2026-W42").
     *
     * @param {{ periods: string[] }} query
     * @returns {Promise<Array<{ board: string, period: string, entries: number }>>}
     */
    listLeaderboardSizes: ({ periods }) =>
      aggregate("leaderboard_entries", [
        { $match: { period: { $in: periods } } },
        { $group: { _id: { board: "$board", period: "$period" }, entries: { $sum: 1 } } },
        { $project: { _id: 0, board: "$_id.board", period: "$_id.period", entries: 1 } },
      ]),
  });
}
