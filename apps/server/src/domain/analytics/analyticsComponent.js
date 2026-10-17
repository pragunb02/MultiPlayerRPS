import { ACHIEVEMENTS, GAMES, QUESTS } from "@classicade/shared";
import { createAnalyticsRange } from "../../models/analyticsRange.js";
import { assertDefined } from "../../utils/assert.js";
import { addDays, BUCKETS, bucketsOf, dayOf, INDIA_TIME_ZONE, startOfDay } from "../../utils/indiaTime.js";
import { isoWeek } from "../leaderboards/isoWeek.js";
import {
  activeIn,
  activeSeries,
  activitySummary,
  conversionRate,
  conversionSeries,
  gamePopularity,
  headline,
  hourHeatmap,
  lastFullWeek,
  leaderboardParticipants,
  matchesPerPlayer,
  matchesSeries,
  matchMix,
  medianDurations,
  newPlayersIn,
  newPlayersSeries,
  notCountedShare,
  previousRange,
  rematchRates,
  retentionCohorts,
  topItems,
  weeklyReturning,
} from "./metrics.js";
import { peopleCount, shareOf } from "./privacy.js";

/** How long a report is reused before it is worked out again (CC-233). */
export const REPORT_TTL_MS = 5 * 60 * 1000;
/** The range the console opens with: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;
const GAME_IDS = Object.freeze(GAMES.map((game) => game.id));

/**
 * The owner console's numbers (CC-233), worked out from what the site already stores. No new tracking: every
 * number comes from finished matches, guest transfers, accounts, achievements, quests and leaderboards. The
 * report holds totals only, never a name, an id or a room code, and hides groups smaller than 5.
 *
 * Reports are kept for 5 minutes per range, because the slowest part reads every match ever played.
 *
 * @param {{
 *   analyticsAccessor: ReturnType<typeof import("../../data/analyticsAccessor.js").createAnalyticsAccessor>,
 *   cache: ReturnType<typeof import("../../utils/ttlCache.js").createTtlCache>,
 * }} deps
 */
export function createAnalyticsComponent({ analyticsAccessor, cache }) {
  assertDefined(analyticsAccessor, "analyticsAccessor");
  assertDefined(cache, "cache");

  /** The moments a range of India days starts and ends, the end not included. */
  const momentsOf = ({ from, to }) => ({
    from: new Date(startOfDay(from)),
    to: new Date(startOfDay(addDays(to, 1))),
  });

  async function build(range, now) {
    const today = dayOf(now);
    const previous = previousRange(range);
    // Leaderboard weeks are UTC weeks, so each India week is matched by the board week its middle falls in.
    const weeks = [
      ...new Map(
        bucketsOf({ ...range, bucket: BUCKETS.WEEK }).map((week) => {
          const board = isoWeek(startOfDay(week) + 12 * 60 * 60 * 1000);
          return [board.id, board];
        }),
      ).values(),
    ];
    const [players, facts, previousFacts, signups, previousSignups, achievements, quests, boards] =
      await Promise.all([
        analyticsAccessor.listPlayerActivity(),
        analyticsAccessor.getMatchFacts(momentsOf(range)),
        analyticsAccessor.getMatchFacts(momentsOf(previous)),
        analyticsAccessor.listSignups(momentsOf(range)),
        analyticsAccessor.listSignups(momentsOf(previous)),
        analyticsAccessor.listAchievementUnlocks(momentsOf(range)),
        analyticsAccessor.listQuestCompletions(momentsOf(range)),
        analyticsAccessor.listLeaderboardSizes({ periods: ["all", ...weeks.map((week) => week.id)] }),
      ]);

    const active = activeIn(players, range);
    const activeBefore = activeIn(players, previous);
    const converted = sumOf(signups.transfers, (row) => row.withMatches);
    const convertedBefore = sumOf(previousSignups.transfers, (row) => row.withMatches);
    const returning = weeklyReturning(players, { ...range, today });
    const headlineWeek = lastFullWeek({ to: range.to, today });
    const [weekBefore, fullWeek] = weeklyReturning(players, {
      from: addDays(headlineWeek, -7),
      to: headlineWeek,
      today,
    });
    const matches = matchMix(facts.mix);

    return Object.freeze({
      range: Object.freeze({ ...range, timeZone: INDIA_TIME_ZONE, previous: Object.freeze(previous) }),
      generatedAt: now,
      overview: Object.freeze({
        headlines: Object.freeze([
          headline({
            id: "activePlayers",
            value: peopleCount(active.total),
            previous: peopleCount(activeBefore.total),
          }),
          headline({ id: "matches", value: matches.total, previous: matchMix(previousFacts.mix).total }),
          headline({
            id: "newPlayers",
            value: peopleCount(newPlayersIn(players, range)),
            previous: peopleCount(newPlayersIn(players, previous)),
          }),
          headline({
            id: "weeklyReturning",
            value: fullWeek.players,
            previous: weekBefore.players,
            week: headlineWeek,
          }),
          headline({
            id: "matchesPerPlayer",
            value: matchesPerPlayer(active),
            previous: matchesPerPlayer(activeBefore),
          }),
          headline({
            id: "guestsConverted",
            value: peopleCount(converted),
            previous: peopleCount(convertedBefore),
          }),
          headline({
            id: "conversionRate",
            value: conversionRate({ converted, activeGuests: active.guests }),
            previous: conversionRate({ converted: convertedBefore, activeGuests: activeBefore.guests }),
          }),
        ]),
      }),
      players: Object.freeze({
        summary: activitySummary(players, range),
        active: Object.freeze(activeSeries(players, range)),
        newPlayers: Object.freeze(newPlayersSeries(players, range)),
        weeklyReturning: Object.freeze(returning),
        kinds: Object.freeze({
          guests: peopleCount(active.guests),
          accounts: peopleCount(active.accounts),
          guestShare: shareOf({ part: active.guests, whole: active.total }),
        }),
        matchesPerPlayer: matchesPerPlayer(active),
      }),
      games: Object.freeze({
        gameIds: GAME_IDS,
        matches: Object.freeze(matchesSeries(facts.byDayGame, { ...range, gameIds: GAME_IDS })),
        popularity: Object.freeze(gamePopularity(facts.byDayGame, GAME_IDS)),
        mix: matches,
        durations: Object.freeze(medianDurations(facts.durations, GAME_IDS)),
        rematch: rematchRates(facts.rooms, GAME_IDS),
        fairPlay: notCountedShare(facts),
      }),
      retention: Object.freeze({ cohorts: Object.freeze(retentionCohorts(players, { ...range, today })) }),
      conversion: Object.freeze({
        series: Object.freeze(conversionSeries(signups, range)),
        guestsConverted: peopleCount(converted),
        accountsCreated: peopleCount(sumOf(signups.accounts, (row) => row.accounts)),
        legacyReturned: peopleCount(sumOf(signups.accounts, (row) => row.legacy)),
        rate: conversionRate({ converted, activeGuests: active.guests }),
      }),
      engagement: Object.freeze({
        hours: Object.freeze(hourHeatmap(facts.byHour)),
        achievements: Object.freeze(
          topItems(
            achievements.map(({ achievementId, players: count }) => ({ id: achievementId, count })),
            ACHIEVEMENTS,
          ),
        ),
        quests: Object.freeze(
          topItems(
            quests.map(({ questId, completions }) => ({ id: questId, count: completions })),
            QUESTS,
          ),
        ),
        leaderboards: leaderboardParticipants(boards, { weeks, now }),
      }),
    });
  }

  return Object.freeze({
    /**
     * The range the console opens with: the 30 India days that end today.
     *
     * @param {{ now: number }} at
     * @returns {Readonly<import("../../models/analyticsRange.js").AnalyticsRange>}
     */
    defaultRange({ now }) {
      const today = dayOf(now);
      return createAnalyticsRange({
        from: addDays(today, 1 - DEFAULT_RANGE_DAYS),
        to: today,
        bucket: BUCKETS.DAY,
      });
    },

    /**
     * The whole report for one range, from the cache when it was worked out less than 5 minutes ago.
     *
     * @param {{ range: Readonly<import("../../models/analyticsRange.js").AnalyticsRange>, now: number }} request
     */
    getReport({ range, now }) {
      return cache.remember({
        key: `${range.from}|${range.to}|${range.bucket}`,
        now,
        make: () => build(range, now),
      });
    },
  });
}

const sumOf = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
