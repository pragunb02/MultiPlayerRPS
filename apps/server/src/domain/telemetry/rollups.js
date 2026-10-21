import { CLIENT_COMMON_FIELDS, TELEMETRY_EVENTS } from "@classicade/shared";

/**
 * The rollup spec (CC-176): for each catalogue event, the field groups its hourly counters (CC-175) are totalled by
 * each India day. Only these groups are ever built, so how many rows a day can make is known in advance and checked
 * against a budget (`worstCaseRows`). Every event is also totalled on its own (the empty group).
 *
 * A row is `{ day, event, group, count, timings? }`: `group` holds the group's fields and their values (null for a
 * field the event left out), `count` how
 * many events, and for an event with timings, each timing's exact p50, p75 and p95 for that day worked out from the
 * counters (each counter is a value and how often it came), with `n`, how many events carried it, and the day's
 * bucket counters, so a range of days can be read later without any single value (`mergeBuckets`).
 *
 * Nothing here holds an id: the counters hold none, and a group is made of catalogue fields only.
 */

/** The most rows one India day may make, whatever arrives (CC-176 AC-4). */
export const ROLLUP_ROW_BUDGET = 20_000;

/** What the values of an open field beyond the busiest few are summed as. Not a catalogue value, so never confused. */
export const OTHER_VALUE = "(other)";

/**
 * Fields whose values are not a closed list: a control is any name of our code's shape, an element any tag and role,
 * a build any stamp. Per group and per values of its other fields, only the busiest are kept and the rest are summed
 * as OTHER_VALUE, so a forged name can never multiply the rows. The console shows the top 10 hotspots and the last 5
 * builds (CC-177).
 */
export const TOP_KEPT = Object.freeze({ control: 25, element: 25, build: 5 });

/** The upper edges of the timing buckets in milliseconds. Every line the console judges against is an edge. */
export const MS_EDGES = Object.freeze([
  10, 20, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1250, 1500, 1800, 2000,
  2500, 3000, 4000, 5000, 6000, 8000, 10_000, 12_500, 15_000, 20_000, 25_000, 30_000, 40_000, 60_000, 120_000,
  300_000, 600_000, 1_800_000, 3_600_000,
]);
/** The upper edges of the layout shift buckets. The Core Web Vitals lines, 0.1 and 0.25, are edges. */
export const CLS_EDGES = Object.freeze([0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5, 100]);

const edgesOf = (field) => (field === "cls" ? CLS_EDGES : MS_EDGES);

/** @param {{ groups?: string[][], timings?: string[] }} spec */
const rollup = ({ groups = [], timings = [] }) =>
  Object.freeze({
    groups: Object.freeze([[], ...groups].map((group) => Object.freeze(group))),
    timings: Object.freeze(timings),
  });

const PAGE_TIMINGS = ["ttfb_ms", "fcp_ms", "lcp_ms", "inp_ms", "cls"];

/** @type {Readonly<Record<string, ReturnType<typeof rollup>>>} */
export const ROLLUP_SPEC = Object.freeze({
  // Pages and visits: landings by entry for the funnels, views per screen.
  page_viewed: rollup({ groups: [["is_landing", "entry"], ["route"], ["build"]] }),
  page_speed_measured: rollup({
    groups: [["route", "device"], ["device"], ["build"], ["was_waking"]],
    timings: PAGE_TIMINGS,
  }),
  visit_ended: rollup({ groups: [["active_s"], ["presses"], ["device"]] }),
  // Presses: hotspots per screen and control, and each screen's presses for their shares.
  control_pressed: rollup({ groups: [["route"], ["route", "control"], ["surface"]] }),
  dead_clicked: rollup({ groups: [["route"], ["route", "control"], ["route", "element"], ["surface"]] }),
  rage_clicked: rollup({ groups: [["route"], ["route", "control"], ["route", "element"], ["surface"]] }),
  action_waited: rollup({ groups: [["control"], ["transport"], ["outcome"]], timings: ["wait_ms"] }),
  // Sign-up and login.
  auth_form_viewed: rollup({ groups: [["form"]] }),
  auth_form_submitted: rollup({ groups: [["form"]] }),
  auth_form_rejected: rollup({ groups: [["form", "field", "rule"]] }),
  account_created: rollup({ groups: [["from_guest"]] }),
  login_succeeded: rollup({ groups: [["from_guest"]] }),
  login_failed: rollup({ groups: [["reason"]] }),
  session_ended: rollup({ groups: [["cause"]] }),
  guest_started: rollup({}),
  // The time to first move, by entry and by the interruptions before it (CC-220, CC-313).
  gameplay_started: rollup({
    groups: [["entry"], ["interruptions_before"], ["game_id"], ["device"]],
    timings: ["since_load_ms"],
  }),
  // Interruptions, text and steps (CC-313).
  interruption_ended: rollup({
    groups: [
      ["surface", "outcome"],
      ["surface", "shown_ms"],
      ["surface", "phase"],
      ["class", "trigger", "phase", "blocking"],
    ],
  }),
  interruption_counted: rollup({
    groups: [
      ["scope", "optional"],
      ["scope", "blocking_optional"],
      ["scope", "essential"],
      ["scope", "device", "optional"],
    ],
  }),
  screen_text_measured: rollup({
    groups: [
      ["route", "words"],
      ["route", "fold_words"],
    ],
  }),
  funnel_step_reached: rollup({ groups: [["funnel", "step"]] }),
  // Errors and connection, by day and by build.
  client_errored: rollup({ groups: [["kind", "error_type"], ["route"], ["build"]] }),
  request_failed: rollup({ groups: [["endpoint", "code"], ["build"]] }),
  socket_changed: rollup({ groups: [["state", "code"], ["build"]] }),
  server_errored: rollup({ groups: [["operation", "code"], ["build"]] }),
});

/** The group written as text, the same for the same fields in any order. */
export const groupKeyOf = (group) =>
  JSON.stringify(Object.entries(group).sort(([a], [b]) => (a < b ? -1 : 1)));

/** How many values a field of an event can take in a group, the absent value of an optional field included. */
function valuesOf(event, field) {
  if (Object.hasOwn(TOP_KEPT, field)) return TOP_KEPT[field] + 1;
  const spec = TELEMETRY_EVENTS[event].fields[field] ?? CLIENT_COMMON_FIELDS[field];
  const absent = spec.optional ? 1 : 0;
  if (spec.kind === "flag") return 2 + absent;
  if (spec.kind === "list") return spec.values.length + absent;
  throw new RangeError(
    `${event}.${field} is ${spec.kind}: only closed lists, flags and capped fields are totalled`,
  );
}

/**
 * The most rows one India day can make under a spec, from the catalogue's closed lists and the caps of TOP_KEPT.
 *
 * @param {typeof ROLLUP_SPEC} spec
 * @returns {{ total: number, byEvent: Record<string, number> }}
 */
export function worstCaseRows(spec) {
  const byEvent = Object.fromEntries(
    Object.entries(spec).map(([event, { groups }]) => [
      event,
      groups.reduce(
        (sum, group) => sum + group.reduce((product, field) => product * valuesOf(event, field), 1),
        0,
      ),
    ]),
  );
  return { total: Object.values(byEvent).reduce((a, b) => a + b, 0), byEvent };
}

/** Values and how often each came, as a sorted list of pairs. */
const sortedPairs = (values) => [...values.entries()].sort(([a], [b]) => a - b);

/** The value at a rank (1-based) of a sorted list of `[value, count]` pairs. */
function atRank(pairs, rank) {
  let seen = 0;
  // The rank is at most the sum of the counts, so a pair is always found.
  return pairs.find(([, count]) => (seen += count) >= rank)[0];
}

const RANKS = Object.freeze({ p50: 0.5, p75: 0.75, p95: 0.95 });

function ranked(pairs) {
  const n = pairs.reduce((sum, [, count]) => sum + count, 0);
  return {
    n,
    ...Object.fromEntries(
      Object.entries(RANKS).map(([name, share]) => [name, atRank(pairs, Math.max(1, Math.ceil(share * n)))]),
    ),
  };
}

/**
 * Exact p50, p75 and p95 by nearest rank, from values and how often each came (the hourly counters).
 *
 * @param {ReadonlyMap<number, number>} values
 * @returns {{ n: number, p50: number, p75: number, p95: number }}
 */
export const percentilesOf = (values) => ranked(sortedPairs(values));

/**
 * p50, p75 and p95 from bucket counters: the upper edge of the bucket the rank falls in, so a percentile read this
 * way is never better than the true one, and "at most the line" is decided exactly when the line is an edge.
 *
 * @param {ReadonlyArray<readonly [number, number]>} buckets  `[upper edge, count]`, sorted
 */
export const bucketPercentiles = (buckets) => ranked(buckets);

/**
 * Sums bucket counters of several days.
 *
 * @param {ReadonlyArray<ReadonlyArray<readonly [number, number]>>} lists
 * @returns {Array<[number, number]>} sorted by edge
 */
export function mergeBuckets(lists) {
  const sums = new Map();
  lists.flat().forEach(([edge, count]) => sums.set(edge, (sums.get(edge) ?? 0) + count));
  return sortedPairs(sums);
}

/** The bucket counters of exact values. */
function bucketsOf(field, values) {
  const edges = edgesOf(field);
  const sums = new Map();
  for (const [value, count] of values) {
    // The last edge is the catalogue's longest value, so every value has a bucket.
    const edge = edges.find((upper) => value <= upper);
    sums.set(edge, (sums.get(edge) ?? 0) + count);
  }
  return sortedPairs(sums);
}

const addValue = (values, value, count) => values.set(value, (values.get(value) ?? 0) + count);

/** Sums one group's counters, keeping each timing's values with how often they came. */
function total(rows, counter, key, group, timings) {
  const row = rows.get(key) ?? {
    group,
    count: 0,
    values: Object.fromEntries(timings.map((t) => [t, new Map()])),
  };
  row.count += counter.count;
  timings.forEach((timing) => {
    if (typeof counter[timing] === "number") addValue(row.values[timing], counter[timing], counter.count);
  });
  rows.set(key, row);
}

/** Folds the quieter values of a capped field into OTHER_VALUE, per values of the group's other fields. */
function capOpenFields(rows, group) {
  const capped = group.filter((field) => Object.hasOwn(TOP_KEPT, field));
  let result = [...rows.values()];
  for (const field of capped) {
    const partitions = new Map();
    result.forEach((row) => {
      const rest = groupKeyOf({ ...row.group, [field]: undefined });
      const members = partitions.get(rest);
      if (members === undefined) partitions.set(rest, [row]);
      else members.push(row);
    });
    result = [...partitions.values()].flatMap((members) => {
      const busiest = [...members].sort(
        (a, b) => b.count - a.count || (a.group[field] < b.group[field] ? -1 : 1),
      );
      const kept = busiest.slice(0, TOP_KEPT[field]);
      const folded = busiest.slice(TOP_KEPT[field]);
      if (folded.length === 0) return kept;
      const other = { group: { ...folded[0].group, [field]: OTHER_VALUE }, count: 0, values: {} };
      folded.forEach((row) => {
        other.count += row.count;
        Object.entries(row.values).forEach(([timing, values]) => {
          other.values[timing] ??= new Map();
          values.forEach((count, value) => addValue(other.values[timing], value, count));
        });
      });
      return [...kept, other];
    });
  }
  return result;
}

/** The timings of a summed row: the exact percentiles and the bucket counters, for the timings it has. */
function timingsOf(values) {
  const entries = Object.entries(values)
    .filter(([, map]) => map.size > 0)
    .map(([timing, map]) => [timing, { ...percentilesOf(map), buckets: bucketsOf(timing, map) }]);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/**
 * One India day's totals from its hourly counters, by the spec. Nothing but the totals is touched, and the work
 * grows with the counters (each is visited once per group of its event). `pause` runs after each group of each
 * event, so a busy day never holds up live games for long (review of #176).
 *
 * @param {{
 *   day: string,
 *   counters: ReadonlyArray<Record<string, unknown> & { name: string, count: number }>,
 *   spec?: typeof ROLLUP_SPEC,
 *   pause?: () => Promise<void>,
 * }} input
 * @returns {Promise<Array<{ day: string, event: string, group: Record<string, string | boolean>, count: number, timings?: Record<string, object> }>>}
 */
export async function rollUpDay({ day, counters, spec = ROLLUP_SPEC, pause = async () => {} }) {
  const byEvent = new Map();
  for (const counter of counters) {
    if (!Object.hasOwn(spec, counter.name)) continue;
    const own = byEvent.get(counter.name);
    if (own === undefined) byEvent.set(counter.name, [counter]);
    else own.push(counter);
  }
  const out = [];
  for (const [event, own] of byEvent) {
    const { groups, timings } = spec[event];
    for (const group of groups) {
      const rows = new Map();
      own.forEach((counter) => {
        // A field the event left out is null, so every row of a group has the same fields.
        const values = Object.fromEntries(group.map((field) => [field, counter[field] ?? null]));
        total(rows, counter, groupKeyOf(values), values, timings);
      });
      capOpenFields(rows, group).forEach(({ group: values, count, values: timingValues }) => {
        const timed = timingsOf(timingValues);
        out.push({ day, event, group: values, count, ...(timed && { timings: timed }) });
      });
      await pause();
    }
  }
  return out;
}
