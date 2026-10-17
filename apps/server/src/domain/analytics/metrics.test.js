import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@classicade/shared";
import { WEEKLY_RETENTION_MS } from "../leaderboards/boards.js";
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
  NO_CHANGE,
  NOT_KEPT,
  notCountedShare,
  previousRange,
  rematchRates,
  retentionCohorts,
  topItems,
  weeklyReturning,
} from "./metrics.js";
import { FEWER_THAN_MIN } from "./privacy.js";

/** A day of play: one counted match against a person unless the test says otherwise. */
const played = (day, overrides = {}) => ({ day, matches: 1, counted: 1, vsPerson: 1, ...overrides });
/** One player of a kind, from their days (strings or full rows), oldest first. */
const player = (kind, ...days) => ({
  kind,
  days: days.map((day) => (typeof day === "string" ? played(day) : day)),
});
const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
const GAME_IDS = ["rps", "tictactoe", "chess"];

describe("activeIn", () => {
  it("counts each player once, by kind, with the matches they finished in the range", () => {
    const players = [
      player("guest", "2026-10-01", "2026-10-02"),
      player("user", played("2026-10-02", { matches: 3 })),
      player("user", "2026-09-30"),
    ];

    expect(activeIn(players, { from: "2026-10-01", to: "2026-10-31" })).toEqual({
      total: 2,
      guests: 1,
      accounts: 1,
      matches: 5,
    });
  });
});

describe("activeSeries", () => {
  it("gives daily actives per day, hiding groups of 1 to 4", () => {
    const players = [...many(5, () => player("guest", "2026-10-01")), player("user", "2026-10-02")];

    expect(activeSeries(players, { from: "2026-10-01", to: "2026-10-03", bucket: "day" })).toEqual([
      { bucket: "2026-10-01", players: 5, guests: 5, accounts: 0 },
      { bucket: "2026-10-02", players: FEWER_THAN_MIN, guests: 0, accounts: FEWER_THAN_MIN },
      { bucket: "2026-10-03", players: 0, guests: 0, accounts: 0 },
    ]);
  });

  it("counts a player once per week however many days they played, and only the days in range", () => {
    const players = many(5, () => player("user", "2026-10-04", "2026-10-05", "2026-10-06"));

    expect(activeSeries(players, { from: "2026-10-05", to: "2026-10-11", bucket: "week" })).toEqual([
      { bucket: "2026-10-05", players: 5, guests: 0, accounts: 5 },
    ]);
    expect(activeSeries(players, { from: "2026-10-04", to: "2026-10-04", bucket: "month" })).toEqual([
      { bucket: "2026-10", players: 5, guests: 0, accounts: 5 },
    ]);
  });
});

describe("activitySummary", () => {
  it("averages daily actives over the range and divides by the last 30 days' actives for stickiness", () => {
    // 10 players: 5 play every day of the 30 days, 5 play once. Daily average 5 + 5/30, monthly 10.
    const days = many(30, (index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
    const players = [
      ...many(5, () => player("user", ...days)),
      ...many(5, () => player("guest", "2026-10-15")),
    ];

    expect(activitySummary(players, { from: "2026-10-01", to: "2026-10-30" })).toEqual({
      dailyAverage: 5.2,
      weekly: 5,
      monthly: 10,
      stickiness: 0.5167,
    });
  });

  it("hides everything when fewer than 5 people played", () => {
    expect(activitySummary([player("user", "2026-10-01")], { from: "2026-10-01", to: "2026-10-01" })).toEqual(
      {
        dailyAverage: FEWER_THAN_MIN,
        weekly: FEWER_THAN_MIN,
        monthly: FEWER_THAN_MIN,
        stickiness: FEWER_THAN_MIN,
      },
    );
  });
});

describe("new players", () => {
  const players = [
    ...many(5, () => player("guest", "2026-10-02", "2026-10-09")),
    player("user", "2026-09-01", "2026-10-02"),
  ];

  it("counts a player in the bucket of their first finished match ever", () => {
    expect(newPlayersSeries(players, { from: "2026-10-01", to: "2026-10-09", bucket: "week" })).toEqual([
      { bucket: "2026-09-28", players: 5 },
      { bucket: "2026-10-05", players: 0 },
    ]);
  });

  it("counts the new players of a range", () => {
    expect(newPlayersIn(players, { from: "2026-10-01", to: "2026-10-31" })).toBe(5);
    expect(newPlayersIn(players, { from: "2026-09-01", to: "2026-09-30" })).toBe(1);
  });
});

describe("weeklyReturning", () => {
  const week = ["2026-10-05", "2026-10-07", "2026-10-09"];

  it("counts players with a counted match on 3 different days of a week, with the guardrail shares", () => {
    const players = [
      ...many(3, () => player("user", ...week)),
      ...many(2, () => player("guest", ...week.map((day) => played(day, { vsPerson: 0 })))),
      player("user", "2026-10-05", "2026-10-06"),
      player("user", ...week.map((day) => played(day, { counted: 0 }))),
    ];

    expect(weeklyReturning(players, { from: "2026-10-05", to: "2026-10-11", today: "2026-10-17" })).toEqual([
      { week: "2026-10-05", complete: true, players: 5, withPerson: 0.6, accounts: 0.6 },
    ]);
  });

  it("marks a week still in progress and hides small groups", () => {
    const players = [player("user", ...week)];

    expect(weeklyReturning(players, { from: "2026-10-05", to: "2026-10-11", today: "2026-10-11" })).toEqual([
      {
        week: "2026-10-05",
        complete: false,
        players: FEWER_THAN_MIN,
        withPerson: FEWER_THAN_MIN,
        accounts: FEWER_THAN_MIN,
      },
    ]);
  });
});

describe("lastFullWeek", () => {
  it("is the week of the range's last day once that week is over", () => {
    expect(lastFullWeek({ to: "2026-10-07", today: "2026-10-17" })).toBe("2026-10-05");
    expect(lastFullWeek({ to: "2026-10-11", today: "2026-10-12" })).toBe("2026-10-05");
  });

  it("is the week before today's when the range ends in the week still going on", () => {
    // Tuesday 13 October: the week from 12 October has had two days, so the full week is the one before.
    expect(lastFullWeek({ to: "2026-10-13", today: "2026-10-13" })).toBe("2026-10-05");
    expect(lastFullWeek({ to: "2026-10-18", today: "2026-10-18" })).toBe("2026-10-05");
  });
});

describe("retentionCohorts", () => {
  it("groups players by the week of their first match and finds who came back exactly 1, 7 and 30 days later", () => {
    // Monday 5 October cohort of 10: 5 back the next day, 2 back on day 7, and day 30 is still ahead for all 10.
    const players = [
      ...many(5, () => player("guest", "2026-10-05", "2026-10-06")),
      ...many(2, () => player("user", "2026-10-07", "2026-10-14")),
      ...many(3, () => player("user", "2026-10-08", "2026-10-10")),
    ];

    const [cohort] = retentionCohorts(players, { from: "2026-10-05", to: "2026-10-11", today: "2026-10-17" });

    expect(cohort).toEqual({
      week: "2026-10-05",
      players: 10,
      returns: [
        { after: 1, eligible: 10, share: 0.5, margin: 0.3099 },
        { after: 7, eligible: 10, share: 0.2, margin: 0.2479 },
        { after: 30, eligible: 0, share: FEWER_THAN_MIN, margin: FEWER_THAN_MIN },
      ],
    });
  });

  it("does not count a return day that is today or later, so a young cohort is not shown as lost", () => {
    const players = many(5, () => player("guest", "2026-10-16"));

    const [cohort] = retentionCohorts(players, { from: "2026-10-12", to: "2026-10-18", today: "2026-10-17" });

    expect(cohort.returns[0]).toEqual({
      after: 1,
      eligible: 0,
      share: FEWER_THAN_MIN,
      margin: FEWER_THAN_MIN,
    });
  });

  it("leaves out players who started before the range, and lists empty weeks", () => {
    const players = [player("user", "2026-09-01", "2026-10-06")];

    expect(retentionCohorts(players, { from: "2026-10-05", to: "2026-10-11", today: "2026-10-17" })).toEqual([
      {
        week: "2026-10-05",
        players: 0,
        returns: [1, 7, 30].map((after) => ({
          after,
          eligible: 0,
          share: FEWER_THAN_MIN,
          margin: FEWER_THAN_MIN,
        })),
      },
    ]);
  });
});

describe("matchesPerPlayer", () => {
  it("averages matches per active player, hidden below 5 players", () => {
    expect(matchesPerPlayer({ total: 8, matches: 20 })).toBe(2.5);
    expect(matchesPerPlayer({ total: 4, matches: 20 })).toBe(FEWER_THAN_MIN);
  });
});

describe("matchesSeries and gamePopularity", () => {
  const rows = [
    { day: "2026-10-01", gameId: "rps", matches: 4 },
    { day: "2026-10-02", gameId: "chess", matches: 2 },
    { day: "2026-10-02", gameId: "rps", matches: 2 },
    { day: "2026-09-30", gameId: "rps", matches: 9 },
  ];

  it("totals matches per bucket and game, inside the range only", () => {
    expect(
      matchesSeries(rows, { from: "2026-10-01", to: "2026-10-02", bucket: "month", gameIds: GAME_IDS }),
    ).toEqual([{ bucket: "2026-10", total: 8, byGame: { rps: 6, tictactoe: 0, chess: 2 } }]);
  });

  it("ranks games by matches with their share, listing games nobody played", () => {
    expect(gamePopularity(rows.slice(0, 3), GAME_IDS)).toEqual([
      { gameId: "rps", matches: 6, share: 0.75 },
      { gameId: "chess", matches: 2, share: 0.25 },
      { gameId: "tictactoe", matches: 0, share: 0 },
    ]);
  });
});

describe("matchMix", () => {
  it("splits matches by who played and counts the ones with a bot", () => {
    const rows = [
      { mix: "accounts", withBot: false, matches: 3 },
      { mix: "guests", withBot: false, matches: 2 },
      { mix: "guests", withBot: true, matches: 1 },
      { mix: "mixed", withBot: false, matches: 4 },
    ];

    expect(matchMix(rows)).toEqual({
      total: 10,
      accountsOnly: 3,
      guestsOnly: 3,
      mixed: 4,
      withBot: 1,
      withBotShare: 0.1,
    });
  });

  it("is all zeros before anyone played, with no bots before CC-138", () => {
    expect(matchMix([])).toEqual({
      total: 0,
      accountsOnly: 0,
      guestsOnly: 0,
      mixed: 0,
      withBot: 0,
      withBotShare: 0,
    });
  });
});

describe("medianDurations", () => {
  it("finds the median from how many matches took each number of seconds", () => {
    const rows = [
      { gameId: "rps", seconds: 30, matches: 2 },
      { gameId: "rps", seconds: 10, matches: 2 },
      { gameId: "rps", seconds: 90, matches: 1 },
      { gameId: "chess", seconds: 300, matches: 3 },
      { gameId: "chess", seconds: 100, matches: 3 },
    ];

    expect(medianDurations(rows, GAME_IDS)).toEqual([
      { gameId: "rps", matches: 5, medianSeconds: 30 },
      { gameId: "tictactoe", matches: 0, medianSeconds: FEWER_THAN_MIN },
      { gameId: "chess", matches: 6, medianSeconds: 200 },
    ]);
  });

  it("hides the median of fewer than 5 matches", () => {
    expect(medianDurations([{ gameId: "rps", seconds: 5, matches: 4 }], ["rps"])).toEqual([
      { gameId: "rps", matches: 4, medianSeconds: FEWER_THAN_MIN },
    ]);
  });
});

describe("rematchRates", () => {
  it("is the share of matches that followed another in the same room, overall and per game", () => {
    const rows = [
      { gameId: "rps", matches: 10, rematches: 6 },
      { gameId: "chess", matches: 10, rematches: 0 },
    ];

    expect(rematchRates(rows, GAME_IDS)).toEqual({
      overall: 0.3,
      byGame: [
        { gameId: "rps", share: 0.6 },
        { gameId: "tictactoe", share: 0 },
        { gameId: "chess", share: 0 },
      ],
    });
  });
});

describe("notCountedShare", () => {
  it("is the share of judged player results that did not count, by reason, largest first", () => {
    const facts = {
      judgedSeats: 40,
      notCounted: [
        { reason: "hourly-limit", seats: 2 },
        { reason: "ended-too-soon", seats: 8 },
      ],
    };

    expect(notCountedShare(facts)).toEqual({
      judgedSeats: 40,
      notCounted: 10,
      share: 0.25,
      reasons: [
        { reason: "ended-too-soon", seats: 8, share: 0.2 },
        { reason: "hourly-limit", seats: 2, share: 0.05 },
      ],
    });
  });

  it("orders reasons with the same count by name", () => {
    const facts = {
      judgedSeats: 10,
      notCounted: [
        { reason: "opponent-daily-limit", seats: 1 },
        { reason: "hourly-limit", seats: 1 },
      ],
    };

    expect(notCountedShare(facts).reasons.map(({ reason }) => reason)).toEqual([
      "hourly-limit",
      "opponent-daily-limit",
    ]);
  });

  it("is zero before any match was judged", () => {
    expect(notCountedShare({ judgedSeats: 0, notCounted: [] })).toEqual({
      judgedSeats: 0,
      notCounted: 0,
      share: 0,
      reasons: [],
    });
  });
});

describe("hourHeatmap", () => {
  it("lays matches out as 7 weekdays of 24 hours, hiding cells of 1 to 4", () => {
    const grid = hourHeatmap([
      { weekday: 1, hour: 20, matches: 12 },
      { weekday: 7, hour: 3, matches: 2 },
    ]);

    expect(grid).toHaveLength(7);
    expect(grid[0].weekday).toBe(1);
    expect(grid[0].hours).toHaveLength(24);
    expect(grid[0].hours[20]).toBe(12);
    expect(grid[0].hours[21]).toBe(0);
    expect(grid[6].hours[3]).toBe(FEWER_THAN_MIN);
  });
});

describe("topItems", () => {
  it("orders items with the same count by id", () => {
    const rows = [
      { id: "wins-10", count: 6 },
      { id: "first-win", count: 6 },
    ];

    expect(topItems(rows, ACHIEVEMENTS).map(({ id }) => id)).toEqual(["first-win", "wins-10"]);
  });

  it("lists the 10 most reached items with their catalog names, hiding small counts", () => {
    const rows = [
      { id: "unknown-later", count: 7 },
      ...many(11, (index) => ({ id: ACHIEVEMENTS[index].id, count: 20 - index })),
      { id: ACHIEVEMENTS[11].id, count: 2 },
    ];

    const top = topItems(rows, ACHIEVEMENTS);

    expect(top).toHaveLength(10);
    expect(top[0]).toEqual({ id: ACHIEVEMENTS[0].id, name: ACHIEVEMENTS[0].name, count: 20 });
    expect(topItems([{ id: "unknown-later", count: 3 }], ACHIEVEMENTS)).toEqual([
      { id: "unknown-later", name: "unknown-later", count: FEWER_THAN_MIN },
    ]);
  });
});

describe("leaderboardParticipants", () => {
  const W41 = isoWeek(Date.parse("2026-10-07T00:00:00.000Z"));
  const W42 = isoWeek(Date.parse("2026-10-14T00:00:00.000Z"));

  it("counts all time entries per board and this range's weekly XP entries", () => {
    const rows = [
      { board: "xp", period: "all", entries: 30 },
      { board: "wins:chess", period: "all", entries: 3 },
      { board: "xp", period: "2026-W41", entries: 12 },
    ];

    expect(leaderboardParticipants(rows, { weeks: [W41, W42], now: W42.endsAt })).toEqual({
      allTime: [
        { board: "wins:chess", entries: FEWER_THAN_MIN },
        { board: "xp", entries: 30 },
      ],
      weekly: [
        { week: "2026-W41", entries: 12 },
        { week: "2026-W42", entries: 0 },
      ],
    });
  });

  it("says a week's board is no longer kept once its entries are removed, instead of showing 0", () => {
    const weekly = (now) => leaderboardParticipants([], { weeks: [W41, W42], now }).weekly;

    expect(weekly(W41.endsAt + WEEKLY_RETENTION_MS - 1)).toEqual([
      { week: "2026-W41", entries: 0 },
      { week: "2026-W42", entries: 0 },
    ]);
    expect(weekly(W41.endsAt + WEEKLY_RETENTION_MS)).toEqual([
      { week: "2026-W41", entries: NOT_KEPT },
      { week: "2026-W42", entries: 0 },
    ]);
  });
});

describe("conversion", () => {
  it("counts converted guests with matches and new accounts per bucket", () => {
    const rows = {
      transfers: [
        { day: "2026-10-01", transfers: 7, withMatches: 6 },
        { day: "2026-10-02", transfers: 2, withMatches: 1 },
      ],
      accounts: [
        { day: "2026-10-01", accounts: 9, legacy: 0 },
        { day: "2026-10-02", accounts: 0, legacy: 6 },
      ],
    };

    expect(conversionSeries(rows, { from: "2026-10-01", to: "2026-10-02", bucket: "day" })).toEqual([
      { bucket: "2026-10-01", guestsConverted: 6, accountsCreated: 9, legacyReturned: 0 },
      { bucket: "2026-10-02", guestsConverted: FEWER_THAN_MIN, accountsCreated: 0, legacyReturned: 6 },
    ]);
  });

  it("adds converted guests back to the guests, because their matches moved to the account", () => {
    expect(conversionRate({ converted: 5, activeGuests: 95 })).toBe(0.05);
    expect(conversionRate({ converted: 1, activeGuests: 3 })).toBe(FEWER_THAN_MIN);
  });
});

describe("headline", () => {
  it("compares a number with the period before as a share of it", () => {
    expect(headline({ id: "matches", value: 150, previous: 100 })).toEqual({
      id: "matches",
      value: 150,
      previous: 100,
      change: 0.5,
    });
  });

  it("says new for growth from zero, zero for no change from zero, and hidden for a hidden number", () => {
    expect(headline({ id: "a", value: 5, previous: 0 }).change).toBe(NO_CHANGE.NEW);
    expect(headline({ id: "a", value: 0, previous: 0 }).change).toBe(0);
    expect(headline({ id: "a", value: FEWER_THAN_MIN, previous: 9 }).change).toBe(NO_CHANGE.HIDDEN);
  });
});

describe("previousRange", () => {
  it("is the same number of days, ending the day before", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-30" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });
});
