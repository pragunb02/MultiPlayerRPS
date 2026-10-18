import { describe, expect, it } from "vitest";
import { ANALYTICS_NOT_COUNTED } from "@classicade/shared";
import { addDays } from "../../utils/indiaTime.js";
import {
  NOT_PLAYING_YET,
  northStarOn,
  STATUSES,
  statusMoves,
  statusOn,
  statusWeeks,
  statusWindow,
} from "./playerStatuses.js";
import { FEWER_THAN_MIN } from "./privacy.js";

// Sunday 18 October 2026, India time. "Back n" is the day n days before it, so back 0 is today, day 1.
const TODAY = "2026-10-18";
const back = (count) => addDays(TODAY, -count);
/** A player's days of play, given as how many days before TODAY each was. */
const daysBack = (...counts) => counts.map(back).sort();
const LONG_AGO = 60;
const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
const player = (days, kind = "guest") => ({ kind, days });

describe("statusOn", () => {
  it("is not playing yet before the first day of play", () => {
    expect(statusOn(daysBack(0), back(1))).toBe(NOT_PLAYING_YET);
  });

  it("is New while the first day of play ever is one of the last 7 days, today being day 1", () => {
    expect(statusOn(daysBack(6), TODAY)).toBe(STATUSES.NEW);
    expect(statusOn(daysBack(0), TODAY)).toBe(STATUSES.NEW);
  });

  it("is no longer New when the first day of play was 8 days back", () => {
    expect(statusOn(daysBack(7, 0), TODAY)).toBe(STATUSES.CASUAL);
  });

  it("wins over Core in the first week", () => {
    expect(statusOn(daysBack(6, 5, 4, 3, 0), TODAY)).toBe(STATUSES.NEW);
  });

  it("is still active when the last day of play was 7 days back", () => {
    expect(statusOn(daysBack(LONG_AGO, 6), TODAY)).toBe(STATUSES.CASUAL);
  });

  it("is Lapsing when the last day of play was 8 days back", () => {
    expect(statusOn(daysBack(LONG_AGO, 7), TODAY)).toBe(STATUSES.LAPSING);
  });

  it("is Lapsing when the last day of play was 14 days back", () => {
    expect(statusOn(daysBack(LONG_AGO, 13), TODAY)).toBe(STATUSES.LAPSING);
  });

  it("is Dormant when the last day of play was 15 days back", () => {
    expect(statusOn(daysBack(LONG_AGO, 14), TODAY)).toBe(STATUSES.DORMANT);
  });

  it("is a New player's status too once their week is over and they stopped", () => {
    expect(statusOn(daysBack(14), TODAY)).toBe(STATUSES.DORMANT);
    expect(statusOn(daysBack(7), TODAY)).toBe(STATUSES.LAPSING);
  });

  it("is Returning on the day of play after 14 days without a game", () => {
    expect(statusOn(daysBack(LONG_AGO, 15, 0), TODAY)).toBe(STATUSES.RETURNING);
  });

  it("is not Returning after only 13 days without a game", () => {
    expect(statusOn(daysBack(LONG_AGO, 14, 0), TODAY)).toBe(STATUSES.CASUAL);
  });

  it("is Returning only on the day of the return", () => {
    expect(statusOn(daysBack(LONG_AGO, 16, 1), TODAY)).toBe(STATUSES.CASUAL);
  });

  it("is Casual with 1 day of play in the last 7, Regular with 2 or 3, Core with 4", () => {
    expect(statusOn(daysBack(LONG_AGO, 0), TODAY)).toBe(STATUSES.CASUAL);
    expect(statusOn(daysBack(LONG_AGO, 6, 0), TODAY)).toBe(STATUSES.REGULAR);
    expect(statusOn(daysBack(LONG_AGO, 6, 3, 0), TODAY)).toBe(STATUSES.REGULAR);
    expect(statusOn(daysBack(LONG_AGO, 6, 3, 1, 0), TODAY)).toBe(STATUSES.CORE);
  });

  it("does not count a day of play 8 days back towards the week", () => {
    expect(statusOn(daysBack(LONG_AGO, 7, 6, 3, 0), TODAY)).toBe(STATUSES.REGULAR);
  });

  it("does not need a game today to be Core", () => {
    expect(statusOn(daysBack(LONG_AGO, 6, 5, 4, 3), TODAY)).toBe(STATUSES.CORE);
  });

  it("ignores days after the day it is worked out for", () => {
    expect(statusOn(daysBack(LONG_AGO, 20, 0), back(1))).toBe(STATUSES.DORMANT);
  });
});

describe("statusWindow", () => {
  it("starts 15 days before the earliest Monday, so its Sunday before has 14 days of history", () => {
    expect(statusWindow({ weeks: ["2026-10-12", "2026-10-05"], today: TODAY })).toEqual({
      from: "2026-09-20",
      to: "2026-10-18",
    });
  });

  it("ends today when the last week is still going on", () => {
    expect(statusWindow({ weeks: ["2026-10-12"], today: "2026-10-14" })).toEqual({
      from: "2026-09-27",
      to: "2026-10-14",
    });
  });
});

describe("statusWeeks", () => {
  const WEEKS = ["2026-10-05", "2026-10-12"];

  it("counts each status on the week's last day, and the week in progress up to today", () => {
    const players = [
      ...many(5, () => player(["2026-10-12"])),
      ...many(5, () => player(["2026-09-01", "2026-10-13"])),
      ...many(6, () => player(["2026-09-01", "2026-10-06", "2026-10-12", "2026-10-13"], "user")),
      ...many(5, () => player(["2026-09-01", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])),
    ];

    expect(statusWeeks(players, { weeks: WEEKS, today: "2026-10-14" })).toEqual([
      {
        week: "2026-10-05",
        through: "2026-10-11",
        complete: true,
        new: 0,
        casual: 6,
        regular: 0,
        core: 5,
        lapsing: 0,
        cameBack: 11,
        wentDormant: 0,
        northStar: 5,
      },
      {
        week: "2026-10-12",
        through: "2026-10-14",
        complete: false,
        new: 5,
        casual: 10,
        regular: 6,
        core: 0,
        lapsing: 0,
        cameBack: 5,
        wentDormant: 0,
        northStar: 6,
      },
    ]);
  });

  it("counts who turned Dormant during the week, on their 15th day without a game", () => {
    const players = many(5, () => player(["2026-09-01", "2026-09-28"]));

    const [first, second] = statusWeeks(players, { weeks: WEEKS, today: TODAY });

    expect(first).toMatchObject({ lapsing: 5, wentDormant: 0 });
    expect(second).toMatchObject({ lapsing: 0, wentDormant: 5 });
  });

  it("leaves out weeks that have not started", () => {
    expect(statusWeeks([], { weeks: ["2026-10-12", "2026-10-19"], today: TODAY })).toHaveLength(1);
  });

  it("hides groups of 1 to 4 players", () => {
    const players = many(4, () => player(["2026-10-12"]));

    expect(statusWeeks(players, { weeks: ["2026-10-12"], today: TODAY })[0]).toMatchObject({
      new: FEWER_THAN_MIN,
      casual: 0,
      northStar: 0,
    });
  });
});

describe("northStarOn", () => {
  it("is Regular plus Core on a day, as a raw count", () => {
    const players = [
      player(daysBack(LONG_AGO, 1, 0)),
      player(daysBack(LONG_AGO, 4, 3, 2, 1)),
      player(daysBack(LONG_AGO, 0)),
      player(daysBack(3, 0)),
    ];

    expect(northStarOn(players, TODAY)).toBe(2);
  });
});

describe("statusMoves", () => {
  const WEEK = "2026-10-12";
  const cell = (moves, from, to) => moves.rows.find((row) => row.from === from).to[to];

  it("compares each player's status on the Sunday before the week with the one on its Sunday", () => {
    const players = [
      ...many(5, () => player(["2026-09-01", "2026-10-10", "2026-10-11", "2026-10-15", "2026-10-16"])),
      ...many(6, () => player(["2026-09-01", "2026-10-10", "2026-10-11"])),
      ...many(5, () => player(["2026-10-14"])),
      ...many(2, () => player(["2026-09-01", "2026-09-10", "2026-10-18"])),
    ];

    const moves = statusMoves(players, { week: WEEK });

    expect(moves.from).toBe("2026-10-11");
    expect(moves.to).toBe("2026-10-18");
    expect(cell(moves, STATUSES.REGULAR, STATUSES.REGULAR)).toBe(5);
    expect(cell(moves, STATUSES.REGULAR, STATUSES.LAPSING)).toBe(6);
    expect(cell(moves, NOT_PLAYING_YET, STATUSES.NEW)).toBe(5);
    expect(cell(moves, STATUSES.DORMANT, STATUSES.RETURNING)).toBe(FEWER_THAN_MIN);
    expect(cell(moves, STATUSES.CORE, STATUSES.CORE)).toBe(0);
  });

  it("lists every status it can come from and go to, in order", () => {
    const moves = statusMoves([], { week: WEEK });

    expect(moves.rows.map((row) => row.from)).toEqual([NOT_PLAYING_YET, ...Object.values(STATUSES)]);
    expect(Object.keys(moves.rows[0].to)).toEqual(Object.values(STATUSES));
  });

  it("says Dormant to Dormant is not counted, because players who stayed away are never read", () => {
    const players = many(5, () => player(["2026-09-01", "2026-09-10"]));

    expect(cell(statusMoves(players, { week: WEEK }), STATUSES.DORMANT, STATUSES.DORMANT)).toBe(
      ANALYTICS_NOT_COUNTED,
    );
  });

  it("leaves out players who had not started by the week's Sunday", () => {
    const players = many(5, () => player(["2026-10-20"]));
    const moves = statusMoves(players, { week: WEEK });

    expect(
      moves.rows.every((row) =>
        Object.values(row.to).every((value) => value === 0 || value === ANALYTICS_NOT_COUNTED),
      ),
    ).toBe(true);
  });
});
