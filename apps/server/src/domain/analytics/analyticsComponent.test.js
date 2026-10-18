import { describe, expect, it } from "vitest";
import { createAnalyticsAccessor } from "../../data/analyticsAccessor.js";
import { createAnalyticsRange } from "../../models/analyticsRange.js";
import { createEmptyAnalyticsDao, NO_MATCH_FACTS } from "../../testing/emptyAnalyticsDao.js";
import { createTtlCache } from "../../utils/ttlCache.js";
import { createAnalyticsComponent, REPORT_TTL_MS, STATUS_SLICE } from "./analyticsComponent.js";
import { FEWER_THAN_MIN } from "./privacy.js";

const NOW = Date.parse("2026-10-17T06:00:00.000Z"); // 11:30 India time, Saturday 17 October
const RANGE = createAnalyticsRange({ from: "2026-10-12", to: "2026-10-17", bucket: "day" });

const played = (day) => ({ day, matches: 2, counted: 2, vsPerson: 2 });
const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));

/** Ten players this week (6 guests, 4 accounts) and five the week before, with fixed totals elsewhere. */
function siteDao(calls = []) {
  const record =
    (name, answer) =>
    async (...args) => {
      calls.push({ name, args });
      return answer(...args);
    };
  return createEmptyAnalyticsDao({
    listPlayerActivity: record("players", () => [
      ...many(6, () => ({
        kind: "guest",
        days: [played("2026-10-12"), played("2026-10-13"), played("2026-10-14")],
      })),
      ...many(4, () => ({ kind: "user", days: [played("2026-10-01"), played("2026-10-15")] })),
      ...many(1, () => ({ kind: "user", days: [played("2026-10-08")] })),
    ]),
    getMatchFacts: record("facts", ({ from }) =>
      from.getTime() === Date.parse("2026-10-11T18:30:00.000Z")
        ? {
            ...NO_MATCH_FACTS,
            byDayGame: [{ day: "2026-10-12", gameId: "rps", matches: 26 }],
            mix: [{ mix: "guests", withBot: false, matches: 26 }],
          }
        : { ...NO_MATCH_FACTS, mix: [{ mix: "accounts", withBot: false, matches: 13 }] },
    ),
    listSignups: record("signups", () => ({
      transfers: [{ day: "2026-10-13", transfers: 6, withMatches: 5 }],
      accounts: [{ day: "2026-10-13", accounts: 7, legacy: 6 }],
    })),
    listAchievementUnlocks: record("achievements", () => [{ achievementId: "first-win", players: 9 }]),
    listQuestCompletions: record("quests", () => [{ questId: "play-3", completions: 3 }]),
    listLeaderboardSizes: record("boards", () => [{ board: "xp", period: "all", entries: 4 }]),
    listPlayerDays: record("playerDays", () => []),
  });
}

function component(dao = siteDao()) {
  return createAnalyticsComponent({
    analyticsAccessor: createAnalyticsAccessor({ analyticsDao: dao }),
    cache: createTtlCache({ ttlMs: REPORT_TTL_MS, maxEntries: 5 }),
  });
}

describe("analyticsComponent", () => {
  it("opens on the last 30 India days, today included", () => {
    expect(component().defaultRange({ now: Date.parse("2026-10-16T19:00:00.000Z") })).toEqual({
      from: "2026-09-18",
      to: "2026-10-17",
      bucket: "day",
    });
  });

  it("asks for the range and the period before it from India midnight to India midnight", async () => {
    const calls = [];
    await component(siteDao(calls)).getReport({ range: RANGE, now: NOW });

    const facts = calls.filter((call) => call.name === "facts").map(({ args: [moments] }) => moments);
    expect(facts).toEqual([
      { from: new Date("2026-10-11T18:30:00.000Z"), to: new Date("2026-10-17T18:30:00.000Z") },
      { from: new Date("2026-10-05T18:30:00.000Z"), to: new Date("2026-10-11T18:30:00.000Z") },
    ]);
    expect(calls.find((call) => call.name === "boards").args[0]).toEqual({ periods: ["all", "2026-W42"] });
  });

  it("puts the headline numbers beside the previous period's", async () => {
    const report = await component().getReport({ range: RANGE, now: NOW });

    expect(report.range).toEqual({
      ...RANGE,
      timeZone: "Asia/Kolkata",
      previous: { from: "2026-10-06", to: "2026-10-11" },
    });
    expect(report.generatedAt).toBe(NOW);
    expect(Object.fromEntries(report.overview.headlines.map(({ id, ...rest }) => [id, rest]))).toEqual({
      northStar: { value: 0, previous: 0, change: 0, week: "2026-10-05" },
      activePlayers: { value: 10, previous: FEWER_THAN_MIN, change: "hidden" },
      matches: { value: 26, previous: 13, change: 1 },
      newPlayers: { value: 6, previous: FEWER_THAN_MIN, change: "hidden" },
      weeklyReturning: { value: 0, previous: 0, change: 0, week: "2026-10-05" },
      matchesPerPlayer: { value: 4.4, previous: FEWER_THAN_MIN, change: "hidden" },
      guestsConverted: { value: 5, previous: 5, change: 0 },
      conversionRate: { value: 0.4545, previous: 1, change: -0.5455 },
    });
  });

  it("puts the last full week's returning players beside the week before, when the range ends mid-week", async () => {
    const tuesday = Date.parse("2026-10-13T06:00:00.000Z");
    const days = (...list) => list.map((day) => played(day));
    const dao = createEmptyAnalyticsDao({
      listPlayerActivity: async () => [
        ...many(5, () => ({ kind: "guest", days: days("2026-09-28", "2026-09-29", "2026-09-30") })),
        ...many(8, () => ({
          kind: "user",
          days: days("2026-10-05", "2026-10-06", "2026-10-07", "2026-10-12", "2026-10-13"),
        })),
      ],
    });
    const analytics = component(dao);

    const report = await analytics.getReport({
      range: analytics.defaultRange({ now: tuesday }),
      now: tuesday,
    });

    // The week from 12 October has had two days, so nobody can have 3 yet. It is not the headline.
    expect(report.overview.headlines.find(({ id }) => id === "weeklyReturning")).toEqual({
      id: "weeklyReturning",
      value: 8,
      previous: 5,
      change: 0.6,
      week: "2026-10-05",
    });
  });

  it("reads the days of play for statuses from India midnight 15 days before the headline week to the end of today", async () => {
    const calls = [];
    await component(siteDao(calls)).getReport({ range: RANGE, now: NOW });

    expect(calls.filter((call) => call.name === "playerDays").map(({ args: [moments] }) => moments)).toEqual([
      { from: new Date("2026-09-19T18:30:00.000Z"), to: new Date("2026-10-17T18:30:00.000Z") },
    ]);
  });

  it("reports statuses by week, the moves of the headline week, and the North Star beside the week before", async () => {
    const dao = createEmptyAnalyticsDao({
      listPlayerDays: async () =>
        many(5, () => ({
          kind: "user",
          days: ["2026-09-01", "2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13"],
        })),
    });

    const report = await component(dao).getReport({ range: RANGE, now: NOW });

    expect(report.overview.headlines[0]).toEqual({
      id: "northStar",
      value: 5,
      previous: 5,
      change: 0,
      week: "2026-10-05",
    });
    expect(report.statuses.weeks).toEqual([
      expect.objectContaining({ week: "2026-10-12", through: "2026-10-17", complete: false, casual: 5 }),
    ]);
    expect(report.statuses.moves).toEqual(
      expect.objectContaining({ week: "2026-10-05", from: "2026-10-04", to: "2026-10-11" }),
    );
    expect(report.statuses.moves.rows.find((row) => row.from === "regular").to.regular).toBe(5);
  });

  it("works statuses out a slice of players at a time, pausing for live games in between, and counts everyone", async () => {
    const dao = createEmptyAnalyticsDao({
      listPlayerDays: async () =>
        many(STATUS_SLICE * 2 + 1, () => ({ kind: "guest", days: ["2026-09-01", "2026-10-13"] })),
    });
    let paused = 0;
    const counting = () => {
      paused += 1;
    };
    setImmediate(counting);

    const report = await component(dao).getReport({ range: RANGE, now: NOW });

    expect(report.statuses.weeks[0].casual).toBe(STATUS_SLICE * 2 + 1);
    expect(paused).toBe(1);
  });

  it("reports every page with totals only and no ids", async () => {
    const report = await component().getReport({ range: RANGE, now: NOW });

    expect(report.players.kinds).toEqual({ guests: 6, accounts: FEWER_THAN_MIN, guestShare: 0.6 });
    expect(report.games.popularity[0]).toEqual({ gameId: "rps", matches: 26, share: 1 });
    expect(report.retention.cohorts).toEqual([expect.objectContaining({ week: "2026-10-12", players: 6 })]);
    expect(report.conversion).toEqual(
      expect.objectContaining({ guestsConverted: 5, accountsCreated: 7, legacyReturned: 6 }),
    );
    expect(report.engagement.achievements).toEqual([{ id: "first-win", name: "First Victory", count: 9 }]);
    expect(report.engagement.quests).toEqual([{ id: "play-3", name: "Warm-up", count: FEWER_THAN_MIN }]);
    expect(report.engagement.leaderboards.allTime).toEqual([{ board: "xp", entries: FEWER_THAN_MIN }]);
    expect(JSON.stringify(report)).not.toMatch(/guest_|user_/);
  });

  it("works a range out once in 5 minutes, and again after that", async () => {
    const calls = [];
    const analytics = component(siteDao(calls));
    const players = () => calls.filter((call) => call.name === "players").length;

    const first = await analytics.getReport({ range: RANGE, now: NOW });
    const second = await analytics.getReport({ range: RANGE, now: NOW + REPORT_TTL_MS - 1 });
    expect(second).toBe(first);
    expect(players()).toBe(1);

    await analytics.getReport({ range: { ...RANGE, bucket: "week" }, now: NOW });
    await analytics.getReport({ range: RANGE, now: NOW + REPORT_TTL_MS });
    expect(players()).toBe(3);
  });

  it("needs its accessor and its cache", () => {
    expect(() => createAnalyticsComponent({ cache: createTtlCache({ ttlMs: 1, maxEntries: 1 }) })).toThrow(
      TypeError,
    );
    expect(() => createAnalyticsComponent({ analyticsAccessor: {} })).toThrow(TypeError);
  });
});
