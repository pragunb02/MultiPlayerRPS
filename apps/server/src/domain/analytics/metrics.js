import { addDays, bucketOf, bucketsOf, daysBetween, daysOf, weekOf } from "../../utils/indiaTime.js";
import {
  FEWER_THAN_MIN,
  marginOfError,
  MIN_GROUP_SIZE,
  peopleCount,
  plainShare,
  shareOf,
} from "./privacy.js";

// Pure metric functions for the owner console (CC-233). Each one takes rows the data layer already grouped
// and returns plain totals. None of them sees a player id: a player is only a kind and the India days they
// finished matches on. Definitions and the reasons for them are in docs/tickets/CC-233.md.

/**
 * @typedef {{ day: string, matches: number, counted: number, vsPerson: number }} ActiveDay
 *   one India day of one player: matches finished, how many of them counted under fair play (ADR-021), and how
 *   many had another person in them (not a bot)
 * @typedef {{ kind: string, days: ReadonlyArray<ActiveDay> }} PlayerActivity
 *   one player, without their id: "guest" or "user", and their days, oldest first
 * @typedef {{ from: string, to: string }} DayRange  India days, both included
 */

const PLAYER_KINDS = Object.freeze({ GUEST: "guest", ACCOUNT: "user" });
/** The return days of the cohort table (PRODUCT_VISION.md section 7.2). */
export const RETURN_DAYS = Object.freeze([1, 7, 30]);
/** Days of real play in one week that make a weekly returning player, the North Star (PRODUCT_VISION.md 7.1). */
export const RETURNING_DAYS_PER_WEEK = 3;
const STICKINESS_DAYS = 30;
const TOP_LIST_LENGTH = 10;

const inRange = (day, { from, to }) => day >= from && day <= to;
const firstDayOf = (player) => player.days[0].day;
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * How many different players finished a match on at least one day of the range, by kind.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange} range
 * @returns {{ total: number, guests: number, accounts: number, matches: number }} raw counts, for other metrics
 */
export function activeIn(players, range) {
  const active = players
    .map((player) => ({ kind: player.kind, days: player.days.filter(({ day }) => inRange(day, range)) }))
    .filter((player) => player.days.length > 0);
  return {
    total: active.length,
    guests: active.filter((player) => player.kind === PLAYER_KINDS.GUEST).length,
    accounts: active.filter((player) => player.kind === PLAYER_KINDS.ACCOUNT).length,
    matches: sum(active, (player) => sum(player.days, (day) => day.matches)),
  };
}

/**
 * Active players per bucket: on a day bucket the daily actives, on a week bucket the weekly actives of that week,
 * and so on. A player counts once per bucket however many days they played in it.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange & { bucket: string }} range
 */
export function activeSeries(players, { from, to, bucket }) {
  const counts = new Map(
    bucketsOf({ from, to, bucket }).map((key) => [key, { total: 0, guests: 0, accounts: 0 }]),
  );
  for (const player of players) {
    const keys = new Set(
      player.days.filter(({ day }) => inRange(day, { from, to })).map(({ day }) => bucketOf(day, bucket)),
    );
    for (const key of keys) {
      const count = counts.get(key);
      count.total += 1;
      count.guests += player.kind === PLAYER_KINDS.GUEST ? 1 : 0;
      count.accounts += player.kind === PLAYER_KINDS.ACCOUNT ? 1 : 0;
    }
  }
  return [...counts].map(([key, count]) =>
    Object.freeze({
      bucket: key,
      players: peopleCount(count.total),
      guests: peopleCount(count.guests),
      accounts: peopleCount(count.accounts),
    }),
  );
}

/**
 * The classic activity summary as of the range's last day: the average daily actives over the range, the
 * players of the last 7 and last 30 days, and stickiness, which is the average daily actives of the last 30 days
 * over the actives of those 30 days. A stickiness of 0.2 means the average player came back 6 days a month.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange} range
 */
export function activitySummary(players, { from, to }) {
  const perDay = new Map();
  for (const player of players) {
    for (const { day } of player.days) {
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
  }
  const dailyAverage = (window) => {
    const days = daysOf(window);
    return sum(days, (day) => perDay.get(day) ?? 0) / days.length;
  };
  const last = (count) => ({ from: addDays(to, 1 - count), to });
  const mau = activeIn(players, last(STICKINESS_DAYS)).total;
  return Object.freeze({
    dailyAverage:
      activeIn(players, { from, to }).total < MIN_GROUP_SIZE
        ? FEWER_THAN_MIN
        : roundTo(dailyAverage({ from, to }), 1),
    weekly: peopleCount(activeIn(players, last(7)).total),
    monthly: peopleCount(mau),
    stickiness: mau < MIN_GROUP_SIZE ? FEWER_THAN_MIN : roundTo(dailyAverage(last(STICKINESS_DAYS)) / mau, 4),
  });
}

/**
 * New players per bucket: players whose first finished match ever falls in it.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange & { bucket: string }} range
 */
export function newPlayersSeries(players, { from, to, bucket }) {
  const firsts = players.map(firstDayOf).filter((day) => inRange(day, { from, to }));
  return bucketsOf({ from, to, bucket }).map((key) =>
    Object.freeze({
      bucket: key,
      players: peopleCount(firsts.filter((day) => bucketOf(day, bucket) === key).length),
    }),
  );
}

/**
 * How many players had their first finished match in the range.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange} range
 * @returns {number}
 */
export const newPlayersIn = (players, range) =>
  players.filter((player) => inRange(firstDayOf(player), range)).length;

/**
 * The North Star for each week that overlaps the range: weekly returning players, who had a day of real play
 * (a match that counted) on 3 or more different days of the week, with its guardrails: the share of them who
 * played a person that week, and the share who are accounts. A week still in progress is marked, because it can
 * only grow.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange & { today: string }} range
 */
export function weeklyReturning(players, { from, to, today }) {
  const weeks = new Map(
    bucketsOf({ from, to, bucket: "week" }).map((week) => [week, { players: 0, withPerson: 0, accounts: 0 }]),
  );
  const first = weeks.keys().next().value;
  const last = addDays([...weeks.keys()].pop(), 6);
  for (const player of players) {
    // Each week this player had real play in: the days, and whether one of those days had a person in it.
    const own = new Map();
    for (const { day, counted, vsPerson } of player.days) {
      if (counted > 0 && inRange(day, { from: first, to: last })) {
        const week = own.get(weekOf(day)) ?? { days: 0, withPerson: false };
        own.set(weekOf(day), { days: week.days + 1, withPerson: week.withPerson || vsPerson > 0 });
      }
    }
    for (const [week, { days, withPerson }] of own) {
      if (days >= RETURNING_DAYS_PER_WEEK) {
        const total = weeks.get(week);
        total.players += 1;
        total.withPerson += withPerson ? 1 : 0;
        total.accounts += player.kind === PLAYER_KINDS.ACCOUNT ? 1 : 0;
      }
    }
  }
  return [...weeks].map(([week, total]) =>
    Object.freeze({
      week,
      complete: addDays(week, 6) < today,
      players: peopleCount(total.players),
      withPerson: shareOf({ part: total.withPerson, whole: total.players }),
      accounts: shareOf({ part: total.accounts, whole: total.players }),
    }),
  );
}

/**
 * The cohort table: players grouped by the week of their first finished match, and the share who finished a
 * match again exactly 1, 7 and 30 days after their first day. Only players whose return day is already over
 * are counted, so a young cohort is not shown as lost. A cell with fewer than 5 such players is hidden.
 *
 * @param {ReadonlyArray<PlayerActivity>} players
 * @param {DayRange & { today: string }} range
 */
export function retentionCohorts(players, { from, to, today }) {
  const cohorts = new Map(bucketsOf({ from, to, bucket: "week" }).map((week) => [week, []]));
  for (const player of players) {
    const first = firstDayOf(player);
    if (inRange(first, { from, to })) {
      cohorts.get(weekOf(first)).push(player);
    }
  }
  return [...cohorts].map(([week, members]) =>
    Object.freeze({
      week,
      players: peopleCount(members.length),
      returns: Object.freeze(
        RETURN_DAYS.map((after) => {
          const due = members.filter((player) => addDays(firstDayOf(player), after) < today);
          const back = due.filter((player) => {
            const target = addDays(firstDayOf(player), after);
            return player.days.some(({ day }) => day === target);
          });
          const share = shareOf({ part: back.length, whole: due.length });
          return Object.freeze({
            after,
            eligible: peopleCount(due.length),
            share,
            margin: share === FEWER_THAN_MIN ? FEWER_THAN_MIN : marginOfError({ share, size: due.length }),
          });
        }),
      ),
    }),
  );
}

/**
 * The average number of matches each active player finished in the range. A match between two players counts
 * once for each of them.
 *
 * @param {{ total: number, matches: number }} active  from `activeIn`
 * @returns {number | typeof FEWER_THAN_MIN}
 */
export const matchesPerPlayer = ({ total, matches }) =>
  total < MIN_GROUP_SIZE ? FEWER_THAN_MIN : roundTo(matches / total, 2);

/**
 * Finished matches per bucket, in total and for each game.
 *
 * @param {ReadonlyArray<{ day: string, gameId: string, matches: number }>} rows
 * @param {DayRange & { bucket: string, gameIds: ReadonlyArray<string> }} range
 */
export function matchesSeries(rows, { from, to, bucket, gameIds }) {
  return bucketsOf({ from, to, bucket }).map((key) => {
    const inBucket = rows.filter(
      (row) => inRange(row.day, { from, to }) && bucketOf(row.day, bucket) === key,
    );
    const byGame = Object.fromEntries(
      gameIds.map((gameId) => [
        gameId,
        sum(
          inBucket.filter((row) => row.gameId === gameId),
          (row) => row.matches,
        ),
      ]),
    );
    return Object.freeze({
      bucket: key,
      total: sum(inBucket, (row) => row.matches),
      byGame: Object.freeze(byGame),
    });
  });
}

/**
 * Each game's matches and its share of all matches, most played first. Games with no matches are listed too.
 *
 * @param {ReadonlyArray<{ gameId: string, matches: number }>} rows
 * @param {ReadonlyArray<string>} gameIds
 */
export function gamePopularity(rows, gameIds) {
  const whole = sum(rows, (row) => row.matches);
  return gameIds
    .map((gameId) => {
      const matches = sum(
        rows.filter((row) => row.gameId === gameId),
        (row) => row.matches,
      );
      return Object.freeze({ gameId, matches, share: plainShare({ part: matches, whole }) });
    })
    .sort((a, b) => b.matches - a.matches || a.gameId.localeCompare(b.gameId));
}

/**
 * Who played whom: matches between accounts only, guests only, or both, and matches with a bot in them. Bots
 * arrive with CC-138, so that count is 0 until then.
 *
 * @param {ReadonlyArray<{ mix: string, withBot: boolean, matches: number }>} rows
 */
export function matchMix(rows) {
  const total = sum(rows, (row) => row.matches);
  const of = (mix) =>
    sum(
      rows.filter((row) => row.mix === mix),
      (row) => row.matches,
    );
  const withBot = sum(
    rows.filter((row) => row.withBot),
    (row) => row.matches,
  );
  return Object.freeze({
    total,
    accountsOnly: of("accounts"),
    guestsOnly: of("guests"),
    mixed: of("mixed"),
    withBot,
    withBotShare: plainShare({ part: withBot, whole: total }),
  });
}

/**
 * The median match length of each game, in whole seconds, from how many matches took each number of seconds.
 * With fewer than 5 matches the median would describe one person's games, so it is hidden.
 *
 * @param {ReadonlyArray<{ gameId: string, seconds: number, matches: number }>} rows
 * @param {ReadonlyArray<string>} gameIds
 */
export function medianDurations(rows, gameIds) {
  return gameIds.map((gameId) => {
    const lengths = rows.filter((row) => row.gameId === gameId).sort((a, b) => a.seconds - b.seconds);
    const matches = sum(lengths, (row) => row.matches);
    return Object.freeze({
      gameId,
      matches,
      medianSeconds: matches < MIN_GROUP_SIZE ? FEWER_THAN_MIN : medianOf(lengths, matches),
    });
  });
}

/** The middle value of a sorted histogram. With an even count it is the mean of the two middle values. */
function medianOf(lengths, count) {
  const valueAt = (position) => {
    let seen = 0;
    return lengths.find(({ matches }) => (seen += matches) > position).seconds;
  };
  const middle = Math.floor(count / 2);
  return count % 2 === 1 ? valueAt(middle) : (valueAt(middle - 1) + valueAt(middle)) / 2;
}

/**
 * The rematch rate: the share of matches that were a rematch, which is a match after the first one in the same
 * room (a rematch keeps the room, ADR-015). Overall and for each game.
 *
 * @param {ReadonlyArray<{ gameId: string, matches: number, rematches: number }>} rows
 * @param {ReadonlyArray<string>} gameIds
 */
export function rematchRates(rows, gameIds) {
  const rate = (picked) =>
    plainShare({ part: sum(picked, (row) => row.rematches), whole: sum(picked, (row) => row.matches) });
  return Object.freeze({
    overall: rate(rows),
    byGame: Object.freeze(
      gameIds.map((gameId) =>
        Object.freeze({ gameId, share: rate(rows.filter((row) => row.gameId === gameId)) }),
      ),
    ),
  });
}

/**
 * The anti-farming check (CC-095): of the player results that were judged, the share that did not count, and
 * why. A rising share means people are farming, or that a limit is too tight for honest play.
 *
 * @param {{ judgedSeats: number, notCounted: ReadonlyArray<{ reason: string, seats: number }> }} facts
 */
export function notCountedShare({ judgedSeats, notCounted }) {
  const seats = sum(notCounted, (row) => row.seats);
  return Object.freeze({
    judgedSeats,
    notCounted: seats,
    share: plainShare({ part: seats, whole: judgedSeats }),
    reasons: Object.freeze(
      [...notCounted]
        .sort((a, b) => b.seats - a.seats || a.reason.localeCompare(b.reason))
        .map(({ reason, seats: count }) =>
          Object.freeze({ reason, seats: count, share: plainShare({ part: count, whole: judgedSeats }) }),
        ),
    ),
  });
}

/**
 * Matches by weekday and hour in India time, as 7 rows (Monday first) of 24 hours. A cell with 1 to 4 matches is
 * hidden: at night a single cell can be one person's habit.
 *
 * @param {ReadonlyArray<{ weekday: number, hour: number, matches: number }>} rows  weekday 1 is Monday, 7 is Sunday
 */
export function hourHeatmap(rows) {
  return Array.from({ length: 7 }, (_, index) =>
    Object.freeze({
      weekday: index + 1,
      hours: Object.freeze(
        Array.from({ length: 24 }, (__, hour) =>
          peopleCount(
            sum(
              rows.filter((row) => row.weekday === index + 1 && row.hour === hour),
              (row) => row.matches,
            ),
          ),
        ),
      ),
    }),
  );
}

/**
 * The most often reached items of a catalog (achievements unlocked, quests completed), most first, with their
 * names from the catalog. Each count is of people, so small ones are hidden.
 *
 * @param {ReadonlyArray<{ id: string, count: number }>} rows
 * @param {ReadonlyArray<{ id: string, name: string }>} catalog
 */
export function topItems(rows, catalog) {
  const names = new Map(catalog.map((item) => [item.id, item.name]));
  return [...rows]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, TOP_LIST_LENGTH)
    .map(({ id, count }) => Object.freeze({ id, name: names.get(id) ?? id, count: peopleCount(count) }));
}

/**
 * How many accounts each leaderboard lists. A board needs 25 entries before its tab is worth showing (ADR-029).
 *
 * @param {ReadonlyArray<{ board: string, period: string, entries: number }>} rows
 * @param {{ weeks: ReadonlyArray<string> }} periods  the weekly board periods ("2026-W42") in the range
 */
export function leaderboardParticipants(rows, { weeks }) {
  const entries = (board, period) =>
    sum(
      rows.filter((row) => row.board === board && row.period === period),
      (row) => row.entries,
    );
  const boards = [...new Set(rows.filter((row) => row.period === "all").map((row) => row.board))].sort();
  return Object.freeze({
    allTime: Object.freeze(
      boards.map((board) => Object.freeze({ board, entries: peopleCount(entries(board, "all")) })),
    ),
    weekly: Object.freeze(
      weeks.map((week) => Object.freeze({ week, entries: peopleCount(entries("xp", week)) })),
    ),
  });
}

/**
 * Sign ups per bucket: guests who made an account or logged in (their games moved, ADR-014), and accounts made
 * by people who never played as a guest.
 *
 * @param {{
 *   transfers: ReadonlyArray<{ day: string, transfers: number, withMatches: number }>,
 *   accounts: ReadonlyArray<{ day: string, accounts: number }>,
 * }} rows
 * @param {DayRange & { bucket: string }} range
 */
export function conversionSeries({ transfers, accounts }, { from, to, bucket }) {
  return bucketsOf({ from, to, bucket }).map((key) => {
    const pick = (row) => inRange(row.day, { from, to }) && bucketOf(row.day, bucket) === key;
    return Object.freeze({
      bucket: key,
      guestsConverted: peopleCount(sum(transfers.filter(pick), (row) => row.withMatches)),
      accountsCreated: peopleCount(sum(accounts.filter(pick), (row) => row.accounts)),
    });
  });
}

/**
 * The guest to account conversion rate of the range: guests with a finished match who became an account, over
 * all guests with a finished match. A converted guest's matches move to the account, so they are added back to
 * the guests here.
 *
 * @param {{ converted: number, activeGuests: number }} counts
 */
export const conversionRate = ({ converted, activeGuests }) =>
  shareOf({ part: converted, whole: converted + activeGuests });

/** What a headline says instead of a change when there is nothing to compare. */
export const NO_CHANGE = Object.freeze({ HIDDEN: "hidden", NEW: "new" });

/**
 * One headline number with the same number for the period before, and the change between them as a share of
 * the earlier one. A hidden number has no change ("hidden"), and growth from zero has no share ("new").
 *
 * @param {{ id: string, value: number | string, previous: number | string }} headline
 */
export function headline({ id, value, previous }) {
  return Object.freeze({ id, value, previous, change: changeOf(value, previous) });
}

function changeOf(value, previous) {
  if (typeof value !== "number" || typeof previous !== "number") {
    return NO_CHANGE.HIDDEN;
  }
  if (previous === 0) {
    return value === 0 ? 0 : NO_CHANGE.NEW;
  }
  return roundTo((value - previous) / previous, 4);
}

/**
 * The range of the same length that ends the day before `from`, for "change versus the previous period".
 *
 * @param {DayRange} range
 * @returns {DayRange}
 */
export function previousRange({ from, to }) {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;
