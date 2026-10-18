import { ANALYTICS_NOT_COUNTED } from "@classicade/shared";
import { addDays, daysBetween, daysOf } from "../../utils/indiaTime.js";
import { peopleCount } from "./privacy.js";

// Player statuses for the owner console (ADR-034 point 4, CC-255). Each India day every player who has ever played
// has exactly one status, worked out from the India days on which a match counted for them. Days are counted back
// with today as day 1, so "the last 7 days" are today and the 6 days before it. The rules and the reasons for
// them are in docs/tickets/CC-255.md.

/**
 * @typedef {{ kind: string, days: ReadonlyArray<string> }} PlayerDays
 *   one player, without their id: "guest" or "user", and the India days of counted play, oldest first, with no
 *   day twice. The first day may be their last day of play before the days that were read, which is all a status
 *   needs to know about the time before
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

/** The place of the last day of play on or before `day`, or minus 1 when there is none. */
function lastIndexOn(days, day) {
  let low = 0;
  let high = days.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (days[middle] <= day) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}

/**
 * A player's status on one India day. The first rule that fits wins: New, Dormant, Lapsing, Returning, Core,
 * Regular, Casual.
 *
 * @param {ReadonlyArray<string>} days  the player's days of play, oldest first
 * @param {string} day  the India day to work it out for
 * @returns {string} a STATUSES value, or NOT_PLAYING_YET before the first day of play
 */
export function statusOn(days, day) {
  const last = lastIndexOn(days, day);
  if (last < 0) {
    return NOT_PLAYING_YET;
  }
  if (daysBetween(days[0], day) < WEEK_DAYS) {
    return STATUSES.NEW;
  }
  const away = daysBetween(days[last], day);
  if (away >= DORMANT_AFTER) {
    return STATUSES.DORMANT;
  }
  if (away >= WEEK_DAYS) {
    return STATUSES.LAPSING;
  }
  // Played today, and was Dormant yesterday: 14 or more days without a game in between.
  if (away === 0 && last > 0 && daysBetween(days[last - 1], day) > DORMANT_AFTER) {
    return STATUSES.RETURNING;
  }
  let recent = 0;
  for (let index = last; index >= 0 && daysBetween(days[index], day) < WEEK_DAYS; index -= 1) {
    recent += 1;
  }
  if (recent >= CORE_DAYS) {
    return STATUSES.CORE;
  }
  return recent >= REGULAR_DAYS ? STATUSES.REGULAR : STATUSES.CASUAL;
}

/** The day a week's statuses are read on: its Sunday, or today while the week is still going on. */
const throughOf = (week, today) => {
  const sunday = addDays(week, WEEK_DAYS - 1);
  return sunday < today ? sunday : today;
};

/**
 * The India days of play to read for a set of weeks. A week's statuses look back to the Sunday before it, and a
 * status on that Sunday looks back 14 more days, so the read starts 15 days before the earliest Monday. Before
 * that, only each player's last day of play is needed.
 *
 * @param {{ weeks: ReadonlyArray<string>, today: string }} weeks  Mondays, and today in India time
 * @returns {{ from: string, to: string }} both days included
 */
export function statusWindow({ weeks, today }) {
  const sorted = [...weeks].sort();
  return {
    from: addDays(sorted[0], -(DORMANT_AFTER + 1)),
    to: throughOf(sorted[sorted.length - 1], today),
  };
}

/**
 * Regular plus Core players on one day, the North Star (ADR-034). A raw count, so the caller decides how to show
 * it.
 *
 * @param {ReadonlyArray<PlayerDays>} players
 * @param {string} day
 * @returns {number}
 */
export function northStarOn(players, day) {
  return players.filter((player) => {
    const status = statusOn(player.days, day);
    return status === STATUSES.REGULAR || status === STATUSES.CORE;
  }).length;
}

/**
 * The weekly trend. For each week that has started: how many players had each lasting status on its last day,
 * and two things that happen on one day, so are counted over the whole week: players who came back (were
 * Returning on a day of it) and players who went dormant (turned Dormant on a day of it). Everyone who stayed
 * dormant is not counted, because that needs every match ever (CC-255).
 *
 * @param {ReadonlyArray<PlayerDays>} players
 * @param {{ weeks: ReadonlyArray<string>, today: string }} weeks  Mondays, and today in India time
 */
export function statusWeeks(players, { weeks, today }) {
  return weeks
    .filter((week) => week <= today)
    .map((week) => {
      const through = throughOf(week, today);
      const days = daysOf({ from: week, to: through });
      const totals = { new: 0, casual: 0, regular: 0, core: 0, lapsing: 0, cameBack: 0, wentDormant: 0 };
      for (const player of players) {
        const status = statusOn(player.days, through);
        if (status in totals) {
          totals[status] += 1;
        }
        const each = days.map((day) => statusOn(player.days, day));
        const before = statusOn(player.days, addDays(week, -1));
        totals.cameBack += each.includes(STATUSES.RETURNING) ? 1 : 0;
        const turnedDormant = each.some(
          (onDay, index) =>
            onDay === STATUSES.DORMANT && (index === 0 ? before : each[index - 1]) !== STATUSES.DORMANT,
        );
        totals.wentDormant += turnedDormant ? 1 : 0;
      }
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
 * @param {ReadonlyArray<PlayerDays>} players
 * @param {{ week: string }} week  the Monday of a week that is over
 */
export function statusMoves(players, { week }) {
  const from = addDays(week, -1);
  const to = addDays(week, WEEK_DAYS - 1);
  const counts = new Map(
    [NOT_PLAYING_YET, ...ORDER].map((status) => [status, new Map(ORDER.map((next) => [next, 0]))]),
  );
  for (const player of players) {
    const after = statusOn(player.days, to);
    if (after !== NOT_PLAYING_YET) {
      const row = counts.get(statusOn(player.days, from));
      row.set(after, row.get(after) + 1);
    }
  }
  return Object.freeze({
    week,
    from,
    to,
    rows: Object.freeze(
      [...counts].map(([status, row]) =>
        Object.freeze({
          from: status,
          to: Object.freeze(
            Object.fromEntries(
              [...row].map(([next, count]) => [
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
