import { ANALYTICS_NOT_COUNTED } from "@classicade/shared";
import { addDays, daysBetween } from "../../utils/indiaTime.js";
import { peopleCount } from "./privacy.js";

// Player statuses for the owner console (ADR-034 point 4, CC-255). Each India day every player who has ever played
// has exactly one status, worked out from the India days on which a match counted for them. Days are counted back
// with today as day 1, so "the last 7 days" are today and the 6 days before it. The rules and the reasons for
// them are in docs/tickets/CC-255.md.
//
// The report runs on the same process as live games, so the work must stay small. Each player's statuses for
// every day of the read window are worked out in one walk through those days (a status book). The weekly trend,
// the moves and the North Star then only look statuses up in it.
//
// Every function here takes an optional meter as its last argument and tells it how many steps it took: days of
// the window walked, days of play read and markers moved, book cells read. Tests use it to check that the work
// grows with players times days and no faster, which a timer cannot check on a busy machine (CC-310). A new loop
// in this file adds its steps to the meter too.

/**
 * @typedef {{ kind: string, days: ReadonlyArray<string> }} PlayerDays
 *   one player, without their id: "guest" or "user", and the India days of counted play, oldest first, with no
 *   day twice. The first day may be their last day of play before the days that were read, which is all a status
 *   needs to know about the time before
 * @typedef {{ from: string, to: string }} StatusWindow  the India days a status book covers, both included
 * @typedef {{ window: StatusWindow, rows: ReadonlyArray<Uint8Array> }} StatusBook
 *   for each player, one status code (a place in CODES) per day of the window
 * @typedef {{ add: (steps: number) => void }} WorkMeter  is told how many steps a function took
 * @typedef {{ meter?: WorkMeter }} Metered  the optional last argument. Without it, no steps are counted
 */

/** The statuses, in the order the console lists them. */
export const STATUSES = Object.freeze({
  NEW: "new",
  CASUAL: "casual",
  REGULAR: "regular",
  CORE: "core",
  RETURNING: "returning",
  LAPSING: "lapsing",
  DORMANT: "dormant",
});

/** The status of a player before their first day of play, used only as where a move came from. */
export const NOT_PLAYING_YET = "notYet";

/** Days in "the last 7 days", today included. */
const WEEK_DAYS = 7;
/** A last day of play this many days back or more makes a player Dormant (day 15, counting today as day 1). */
const DORMANT_AFTER = 14;
/** Days of play in the last 7 that make a player Regular, and Core. */
const REGULAR_DAYS = 2;
const CORE_DAYS = 4;
const ORDER = Object.freeze(Object.values(STATUSES));
/** Every status a book can hold, as small numbers so a book is a compact array. */
const CODES = Object.freeze([NOT_PLAYING_YET, ...ORDER]);
const CODE = Object.freeze(Object.fromEntries(CODES.map((status, index) => [status, index])));
const DAY_MS = 24 * 60 * 60 * 1000;
/** The meter used when the caller does not count the work, as the server does not. */
const UNMETERED = Object.freeze({ add: () => undefined });

/** A day as a whole number of days, so the walk compares numbers instead of reading dates. */
const dayNumber = (day) => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;

/** The status code on day `today` from what the walk knows about the days of play up to it. */
function codeOf({ first, last, previous, recent, today }) {
  if (today - first < WEEK_DAYS) {
    return CODE.new;
  }
  const away = today - last;
  if (away >= DORMANT_AFTER) {
    return CODE.dormant;
  }
  if (away >= WEEK_DAYS) {
    return CODE.lapsing;
  }
  // Played today, and was Dormant yesterday: 14 or more days without a game in between.
  if (away === 0 && today - previous > DORMANT_AFTER) {
    return CODE.returning;
  }
  if (recent >= CORE_DAYS) {
    return CODE.core;
  }
  return recent >= REGULAR_DAYS ? CODE.regular : CODE.casual;
}

/**
 * One player's status on every day of a window, in one walk through its days. Two markers move forwards
 * through the days of play: one past the days up to today, one past the days before the last 7.
 *
 * @param {ReadonlyArray<string>} days  the player's days of play, oldest first
 * @param {StatusWindow} window
 * @param {WorkMeter} meter
 * @returns {Uint8Array} a status code per day of the window
 */
function statusRow(days, { from, to }, meter) {
  const played = days.map(dayNumber);
  const start = dayNumber(from);
  const row = new Uint8Array(dayNumber(to) - start + 1);
  let seen = 0;
  let old = 0;
  // Counted in a local number and told to the meter once, so the walk stays as fast without a meter.
  let steps = played.length;
  for (let index = 0; index < row.length; index += 1) {
    const today = start + index;
    steps += 1;
    while (seen < played.length && played[seen] <= today) {
      seen += 1;
      steps += 1;
    }
    while (old < seen && played[old] <= today - WEEK_DAYS) {
      old += 1;
      steps += 1;
    }
    row[index] =
      seen === 0
        ? CODE.notYet
        : codeOf({
            first: played[0],
            last: played[seen - 1],
            previous: seen > 1 ? played[seen - 2] : -Infinity,
            recent: seen - old,
            today,
          });
  }
  meter.add(steps);
  return row;
}

/**
 * The status book of a group of players: each one's status on every day of the window. The caller may build it
 * in slices of players and join the rows, so a big book never holds up live games in one go.
 *
 * @param {ReadonlyArray<PlayerDays>} players
 * @param {StatusWindow} window
 * @param {Metered} [metered]
 * @returns {Uint8Array[]} one row per player, in the same order
 */
export const statusRows = (players, window, { meter = UNMETERED } = {}) =>
  players.map((player) => statusRow(player.days, window, meter));

/** The status on `day` in a book row. */
const statusIn = (book, row, day) => CODES[row[daysBetween(book.window.from, day)]];

/**
 * A player's status on one India day. The first rule that fits wins: New, Dormant, Lapsing, Returning, Core,
 * Regular, Casual.
 *
 * @param {ReadonlyArray<string>} days  the player's days of play, oldest first
 * @param {string} day  the India day to work it out for
 * @returns {string} a STATUSES value, or NOT_PLAYING_YET before the first day of play
 */
export const statusOn = (days, day) => CODES[statusRow(days, { from: day, to: day }, UNMETERED)[0]];

/** The day a week's statuses are read on: its Sunday, or today while the week is still going on. */
const throughOf = (week, today) => {
  const sunday = addDays(week, WEEK_DAYS - 1);
  return sunday < today ? sunday : today;
};

/**
 * The India days a status book needs for a set of weeks. A week's statuses look back to the Sunday before it,
 * and a status on that Sunday looks back 14 more days, so the read starts 15 days before the earliest Monday.
 * Before that, only each player's last day of play is needed.
 *
 * @param {{ weeks: ReadonlyArray<string>, today: string }} weeks  Mondays, and today in India time
 * @returns {StatusWindow}
 */
export function statusWindow({ weeks, today }) {
  const sorted = [...weeks].sort();
  return {
    from: addDays(sorted[0], -(DORMANT_AFTER + 1)),
    to: throughOf(sorted[sorted.length - 1], today),
  };
}

/**
 * Regular plus Core players on one day of the book, the North Star (ADR-034). A raw count, so the caller decides
 * how to show it.
 *
 * @param {StatusBook} book
 * @param {string} day
 * @param {Metered} [metered]
 * @returns {number}
 */
export function northStarOn(book, day, { meter = UNMETERED } = {}) {
  meter.add(book.rows.length);
  return book.rows.filter((row) => {
    const status = statusIn(book, row, day);
    return status === STATUSES.REGULAR || status === STATUSES.CORE;
  }).length;
}

/**
 * The weekly trend. For each week that has started: how many players had each lasting status on its last day,
 * and two things that happen on one day, so are counted over the whole week: players who came back (were
 * Returning on a day of it) and players who went dormant (turned Dormant on a day of it). Everyone who stayed
 * dormant is not counted, because that needs every match ever (CC-255).
 *
 * @param {StatusBook} book  covering the Sunday before the first week up to the last week's last day
 * @param {{ weeks: ReadonlyArray<string>, today: string }} weeks  Mondays, and today in India time
 * @param {Metered} [metered]
 */
export function statusWeeks(book, { weeks, today }, { meter = UNMETERED } = {}) {
  return weeks
    .filter((week) => week <= today)
    .map((week) => {
      const through = throughOf(week, today);
      // The Sunday before the week, then each day of it up to `through`, as places in the book.
      const first = daysBetween(book.window.from, week) - 1;
      const last = daysBetween(book.window.from, through);
      const totals = { new: 0, casual: 0, regular: 0, core: 0, lapsing: 0, cameBack: 0, wentDormant: 0 };
      // Counted in a local number and told to the meter once per week: each row's last day, and each day read.
      let steps = 0;
      for (const row of book.rows) {
        steps += 1;
        const status = CODES[row[last]];
        if (status in totals) {
          totals[status] += 1;
        }
        let cameBack = false;
        let wentDormant = false;
        for (let place = first + 1; place <= last; place += 1) {
          steps += 1;
          cameBack ||= row[place] === CODE.returning;
          wentDormant ||= row[place] === CODE.dormant && row[place - 1] !== CODE.dormant;
        }
        totals.cameBack += cameBack ? 1 : 0;
        totals.wentDormant += wentDormant ? 1 : 0;
      }
      meter.add(steps);
      return Object.freeze({
        week,
        through,
        complete: addDays(week, WEEK_DAYS - 1) < today,
        new: peopleCount(totals.new),
        casual: peopleCount(totals.casual),
        regular: peopleCount(totals.regular),
        core: peopleCount(totals.core),
        lapsing: peopleCount(totals.lapsing),
        cameBack: peopleCount(totals.cameBack),
        wentDormant: peopleCount(totals.wentDormant),
        northStar: peopleCount(totals.regular + totals.core),
      });
    });
}

/**
 * How players moved in one full week: each player's status on the Sunday before it against their status on its
 * Sunday. Players who stayed Dormant are never read, so that cell says it is not counted.
 *
 * @param {StatusBook} book  covering both Sundays
 * @param {{ week: string }} week  the Monday of a week that is over
 * @param {Metered} [metered]
 */
export function statusMoves(book, { week }, { meter = UNMETERED } = {}) {
  const from = addDays(week, -1);
  const to = addDays(week, WEEK_DAYS - 1);
  const counts = new Map(CODES.map((status) => [status, new Map(ORDER.map((next) => [next, 0]))]));
  meter.add(2 * book.rows.length);
  for (const row of book.rows) {
    const after = statusIn(book, row, to);
    if (after !== NOT_PLAYING_YET) {
      const moves = counts.get(statusIn(book, row, from));
      moves.set(after, moves.get(after) + 1);
    }
  }
  return Object.freeze({
    week,
    from,
    to,
    rows: Object.freeze(
      [...counts].map(([status, moves]) =>
        Object.freeze({
          from: status,
          to: Object.freeze(
            Object.fromEntries(
              [...moves].map(([next, count]) => [
                next,
                status === STATUSES.DORMANT && next === STATUSES.DORMANT
                  ? ANALYTICS_NOT_COUNTED
                  : peopleCount(count),
              ]),
            ),
          ),
        }),
      ),
    ),
  });
}
