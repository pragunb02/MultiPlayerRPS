import {
  FUNNELS,
  surfaceNamed,
  TELEMETRY_BUCKETS,
  TEXT_BUDGETS,
  TEXT_LAST_MEASURED,
  OVER_BUDGET_TODAY,
} from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { addDays, dayOf, daysBetween, daysOf, weekOf } from "../../utils/indiaTime.js";
import { BUDGET_COLOURS, colourBudget, SURFACE_MIN_SHOWN } from "./interruptionBudget.js";
import { OTHER_VALUE } from "./rollups.js";
import { FEWER_THAN_MIN, hideSmall, shareOrHidden } from "./telemetryReport.js";

/** How long a report is reused before it is worked out again (ADR-036.4, CC-177). */
export const UX_REPORT_TTL_MS = 5 * 60 * 1000;
/** The range the page opens with: the last 7 full India days, against the 7 before (owner default, 2026-10-22). */
export const UX_DEFAULT_DAYS = 7;
/** The sections of `/admin/ux`, in tab order. `week` and `badge` are CC-313's, behind `console_ux_week`. */
export const UX_SECTIONS = Object.freeze([
  "funnels",
  "clicks",
  "errors",
  "speed",
  "latency",
  "interruptions",
  "week",
  "badge",
]);
/** The sections behind `console_ux_week` rather than `console_ux`. */
export const UX_WEEK_SECTIONS = Object.freeze(["week", "badge"]);
/** Hotspots shown per kind (CC-177: top 10). */
export const TOP_HOTSPOTS = 10;
/** Builds shown side by side (owner default, 2026-10-22: the last 5). */
export const BUILDS_SHOWN = 5;

/**
 * The lines speed is judged against: the Core Web Vitals "good" lines at p75 (web.dev), and GROWTH 2.5's budget
 * where it is stricter (owner default, 2026-10-22). GROWTH 2.5 names the same three today, so no line is stricter yet;
 * a stricter budget written there goes in `growth` and wins.
 */
export const SPEED_LINES = Object.freeze({
  lcp_ms: Object.freeze({ cwv: 2500, growth: 2500 }),
  inp_ms: Object.freeze({ cwv: 200, growth: 200 }),
  cls: Object.freeze({ cwv: 0.1, growth: 0.1 }),
  fcp_ms: Object.freeze({ cwv: 1800 }),
  ttfb_ms: Object.freeze({ cwv: 800 }),
});
/** The time to first move target at p75 (EVENTS.md 3.4, CC-220). */
export const FIRST_MOVE_TARGET_MS = 10_000;
const lineOf = ({ cwv, growth }) => Math.min(cwv, growth ?? cwv);
const SPEED_FIELDS = Object.keys(SPEED_LINES);
const ERROR_EVENTS = Object.freeze(["client_errored", "request_failed", "socket_changed", "server_errored"]);

const isRoomRoute = (route) =>
  typeof route === "string" && (route.includes("/rooms/:code") || route === "/room/:code");
const sum = (rows, pick = () => true) => rows.filter(pick).reduce((total, { count }) => total + count, 0);
const round = (value) => Math.round(value * 10_000) / 10_000;
const isShown = (count) => count === 0 || count >= 5;

/**
 * The change from one period to the next, as a fraction, worked out on exact totals but only when both are shown:
 * "new" when it grew from zero, null when either side is hidden.
 */
export function changeOf(now, before) {
  if (!isShown(now) || !isShown(before)) return null;
  if (before === 0) return now === 0 ? 0 : "new";
  return round(now / before - 1);
}

/** A count with its period before and the change, each hidden when small. */
const compared = (now, before) => ({
  now: hideSmall(now),
  before: hideSmall(before),
  change: changeOf(now, before),
});

/** A percentile for the console: hidden when fewer than 5 values were behind it. */
const percentile = (timing, name = "p75") =>
  timing === undefined ? null : timing.n < 5 ? FEWER_THAN_MIN : timing[name];

/** A funnel step's ratio to the step before, capped at 100 % and said so (CC-177: a ratio of totals, never ids). */
function stepRatio(part, whole) {
  const share = shareOrHidden(part, whole);
  if (share === FEWER_THAN_MIN) return { ratio: FEWER_THAN_MIN, capped: false };
  return { ratio: Math.min(1, share), capped: share > 1 };
}

/** The range the page opens with and the range before any range. */
export function defaultRange(now) {
  const today = dayOf(now);
  return { from: addDays(today, -UX_DEFAULT_DAYS), to: addDays(today, -1) };
}
export const rangeBefore = ({ from, to }) => {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
};
/** The last full Monday to Sunday India week before today (CC-313 section 8). */
export function lastFullWeekOf(now) {
  const monday = addDays(weekOf(dayOf(now)), -7);
  return { from: monday, to: addDays(monday, 6) };
}

/**
 * The owner's UX page (CC-177) and weekly report (CC-313 section 8), worked out from the daily totals (CC-176) on
 * read and kept 5 minutes per section and range. Exact totals stay inside: every count that leaves is `"<5"` from 1
 * to 4, every share whose part or whole is 1 to 4 is `"<5"`, and every percentile of fewer than 5 values is `"<5"`.
 * Nothing about who asked is taken, kept or logged.
 *
 * @param {{
 *   telemetryReport: ReturnType<typeof import("./telemetryReport.js").createTelemetryReport>,
 *   cache: ReturnType<typeof import("../../utils/ttlCache.js").createTtlCache>,
 *   now: () => number,
 * }} deps
 */
export function createUxReport({ telemetryReport, cache, now }) {
  assertDefined(telemetryReport, "telemetryReport");
  assertDefined(cache, "cache");
  assertFunction(now, "now");
  const totals = (range, event, group) => telemetryReport.totals({ ...range, event, group });
  const totalOf = async (range, event) => sum(await totals(range, event, []));

  // 1. Funnels: visit to play, link to seat, sign-up, then CC-313's registered step funnels.
  async function funnelsOf(range) {
    const landings = await totals(range, "page_viewed", ["is_landing", "entry"]);
    const firstMoves = await totals(range, "gameplay_started", ["entry"]);
    const pressed = await totals(range, "control_pressed", ["route", "control"]);
    const viewed = await totals(range, "auth_form_viewed", ["form"]);
    const submitted = await totals(range, "auth_form_submitted", ["form"]);
    const signup = ({ group }) => group.form === "signup";
    const landed = ({ group }) => group.is_landing === true;
    return {
      visitToPlay: [sum(landings, landed), sum(firstMoves)],
      linkToSeat: [
        sum(landings, (row) => landed(row) && row.group.entry === "room_link"),
        sum(pressed, ({ group }) => group.control === "join.guest" && isRoomRoute(group.route)),
        await totalOf(range, "guest_started"),
      ],
      signUp: [sum(viewed, signup), sum(submitted, signup), await totalOf(range, "account_created")],
      byEntry: Object.fromEntries(
        [
          ...new Set([
            ...landings.filter(landed).map(({ group }) => group.entry),
            ...firstMoves.map(({ group }) => group.entry),
          ]),
        ]
          .filter((entry) => entry !== null)
          .map((entry) => [
            entry,
            [
              sum(landings, (row) => landed(row) && row.group.entry === entry),
              sum(firstMoves, ({ group }) => group.entry === entry),
            ],
          ]),
      ),
      rejected: (await totals(range, "auth_form_rejected", ["form", "field", "rule"])).filter(signup),
      steps: await totals(range, "funnel_step_reached", ["funnel", "step"]),
    };
  }

  async function funnels(range, before) {
    const [now, then] = await Promise.all([funnelsOf(range), funnelsOf(before)]);
    const steps = (ids, values, previous) =>
      ids.map((id, index) => ({
        id,
        ...compared(values[index], previous[index]),
        ...(index > 0 ? stepRatio(values[index], values[index - 1]) : {}),
      }));
    const stepTotal = (rows, funnel, step) =>
      sum(rows, ({ group }) => group.funnel === funnel && group.step === step);
    return {
      funnels: [
        { id: "visit_to_play", steps: steps(["landed", "first_move"], now.visitToPlay, then.visitToPlay) },
        {
          id: "link_to_seat",
          steps: steps(["room_link_landed", "join_guest", "guest_started"], now.linkToSeat, then.linkToSeat),
        },
        {
          id: "sign_up",
          steps: steps(["form_viewed", "form_submitted", "account_created"], now.signUp, then.signUp),
        },
      ],
      byEntry: Object.entries(now.byEntry)
        .sort(([, a], [, b]) => b[0] - a[0])
        .map(([entry, [landed, played]]) => ({
          entry,
          landings: hideSmall(landed),
          firstMoves: hideSmall(played),
          ...stepRatio(played, landed),
        })),
      rejected: now.rejected.map(({ group, count }) => ({
        field: group.field,
        rule: group.rule,
        count: hideSmall(count),
      })),
      registered: FUNNELS.map((funnel) => ({
        id: funnel.id,
        steps: funnel.steps.map((step, index) => {
          const reached = stepTotal(now.steps, funnel.id, step.id);
          const earlier = stepTotal(then.steps, funnel.id, step.id);
          return {
            id: step.id,
            ticket: step.ticket,
            ...compared(reached, earlier),
            // A step with nothing before and something now is new in this period.
            isNew: earlier === 0 && reached > 0,
            ...(index > 0
              ? stepRatio(reached, stepTotal(now.steps, funnel.id, funnel.steps[index - 1].id))
              : {}),
          };
        }),
      })),
    };
  }

  // 2. Clicks: the top dead and rage click hotspots by route and control, each with its share of the route's presses.
  async function hotspotsOf(range, event, presses) {
    const byControl = await totals(range, event, ["route", "control"]);
    const byElement = await totals(range, event, ["route", "element"]);
    const spots = [
      ...byControl
        .filter(({ group }) => group.control !== null)
        .map(({ group, count }) => ({ route: group.route, target: group.control, by: "control", count })),
      ...byElement
        .filter(({ group }) => group.element !== null)
        .map(({ group, count }) => ({ route: group.route, target: group.element, by: "element", count })),
    ]
      .sort((a, b) => b.count - a.count || (`${a.route}${a.target}` < `${b.route}${b.target}` ? -1 : 1))
      .slice(0, TOP_HOTSPOTS);
    return spots.map(({ route, target, by, count }) => {
      const routePresses = presses.find(({ group }) => group.route === route)?.count ?? 0;
      return {
        route,
        target: target === OTHER_VALUE ? "other" : target,
        by,
        count: hideSmall(count),
        share: shareOrHidden(count, routePresses),
      };
    });
  }

  async function clicks(range, before) {
    const presses = await totals(range, "control_pressed", ["route"]);
    const counts = async (period) => ({
      presses: await totalOf(period, "control_pressed"),
      dead: await totalOf(period, "dead_clicked"),
      rage: await totalOf(period, "rage_clicked"),
    });
    const [now, then] = await Promise.all([counts(range), counts(before)]);
    const per100 = (period) => shareOrHidden((period.dead + period.rage) * 100, period.presses);
    return {
      presses: compared(now.presses, then.presses),
      dead: compared(now.dead, then.dead),
      rage: compared(now.rage, then.rage),
      per100Presses: { now: per100(now), before: per100(then) },
      deadHotspots: await hotspotsOf(range, "dead_clicked", presses),
      rageHotspots: await hotspotsOf(range, "rage_clicked", presses),
    };
  }

  /** The last builds seen in a range, newest first: build stamps start with the calendar version. */
  async function lastBuilds(range) {
    const views = await totals(range, "page_viewed", ["build"]);
    return views
      .map(({ group }) => group.build)
      .filter((build) => build !== OTHER_VALUE)
      .sort()
      .reverse()
      .slice(0, BUILDS_SHOWN);
  }

  // 3. Errors per day and by build.
  async function errors(range, before) {
    const builds = await lastBuilds(range);
    const views = await totals(range, "page_viewed", ["build"]);
    const rows = await Promise.all(
      ERROR_EVENTS.map(async (event) => {
        const [now, then, byDay, byBuild] = await Promise.all([
          totalOf(range, event),
          totalOf(before, event),
          telemetryReport.series({ ...range, event, group: [] }),
          totals(range, event, ["build"]),
        ]);
        return {
          event,
          ...compared(now, then),
          byDay: daysOf(range).map((day) => ({
            day,
            count: hideSmall(byDay.find((row) => row.day === day)?.count ?? 0),
          })),
          byBuild: builds.map((build) => {
            const count = byBuild.find(({ group }) => group.build === build)?.count ?? 0;
            const pages = views.find(({ group }) => group.build === build)?.count ?? 0;
            return { build, count: hideSmall(count), per100Pages: shareOrHidden(count * 100, pages) };
          }),
        };
      }),
    );
    const top = async (event, fields) =>
      (await totals(range, event, fields))
        .slice(0, TOP_HOTSPOTS)
        .map(({ group, count }) => ({ ...group, count: hideSmall(count) }));
    return {
      builds,
      events: rows,
      clientErrors: await top("client_errored", ["kind", "error_type"]),
      failedRequests: await top("request_failed", ["endpoint", "code"]),
      serverErrors: await top("server_errored", ["operation", "code"]),
    };
  }

  // 4. Speed: p75 by route and device against the lines, the time to first move, and by build.
  const p75s = (timings) =>
    Object.fromEntries(SPEED_FIELDS.map((field) => [field, percentile(timings?.[field])]));
  const goodOf = (values) =>
    Object.fromEntries(
      SPEED_FIELDS.map((field) => [
        field,
        typeof values[field] === "number" ? values[field] <= lineOf(SPEED_LINES[field]) : null,
      ]),
    );
  async function speed(range, before) {
    const builds = await lastBuilds(range);
    const [byRoute, byDevice, byBuild, all, allBefore, firstByEntry, firstAll, firstBefore] =
      await Promise.all([
        totals(range, "page_speed_measured", ["route", "device"]),
        totals(range, "page_speed_measured", ["device"]),
        totals(range, "page_speed_measured", ["build"]),
        totals(range, "page_speed_measured", []),
        totals(before, "page_speed_measured", []),
        totals(range, "gameplay_started", ["entry"]),
        totals(range, "gameplay_started", []),
        totals(before, "gameplay_started", []),
      ]);
    const row = ({ group, count, timings }) => {
      const p75 = p75s(timings);
      return { ...group, pages: hideSmall(count), p75, good: goodOf(p75) };
    };
    const firstMove = (rows) => percentile(rows[0]?.timings?.since_load_ms);
    return {
      lines: Object.fromEntries(
        SPEED_FIELDS.map((field) => [field, { ...SPEED_LINES[field], line: lineOf(SPEED_LINES[field]) }]),
      ),
      overall: {
        now: row(all[0] ?? { group: {}, count: 0 }),
        before: row(allBefore[0] ?? { group: {}, count: 0 }),
      },
      byDevice: byDevice.map(row),
      byRouteDevice: byRoute.map(row),
      byBuild: builds.map((build) =>
        row(byBuild.find(({ group }) => group.build === build) ?? { group: { build }, count: 0 }),
      ),
      firstMove: {
        target: FIRST_MOVE_TARGET_MS,
        now: firstMove(firstAll),
        before: firstMove(firstBefore),
        byEntry: firstByEntry.map(({ group, count, timings }) => ({
          entry: group.entry,
          games: hideSmall(count),
          p75: percentile(timings?.since_load_ms),
        })),
      },
    };
  }

  // 5. Latency per control as the player feels it (CC-240).
  async function latency(range) {
    const rows = await totals(range, "action_waited", ["control"]);
    const outcomes = await totals(range, "action_waited", ["outcome"]);
    return {
      controls: rows.slice(0, 20).map(({ group, count, timings }) => ({
        control: group.control === OTHER_VALUE ? "other" : group.control,
        presses: hideSmall(count),
        p50: percentile(timings?.wait_ms, "p50"),
        p95: percentile(timings?.wait_ms, "p95"),
      })),
      outcomes: outcomes.map(({ group, count }) => ({ outcome: group.outcome, count: hideSmall(count) })),
    };
  }

  // 6. The interruption budget (CC-313 section 5), from exact totals, shown with "<5".
  async function budgetTotals(range) {
    const fourWeeksBefore = { from: addDays(range.from, -28), to: addDays(range.from, -1) };
    const [visits, ended, counted, presses, rage, dead, first, firstBefore, bySurface] = await Promise.all([
      totalOf(range, "visit_ended"),
      totals(range, "interruption_ended", ["class", "trigger", "phase", "blocking"]),
      totals(range, "interruption_counted", ["scope", "optional"]),
      totalOf(range, "control_pressed"),
      totalOf(range, "rage_clicked"),
      totalOf(range, "dead_clicked"),
      totals(range, "gameplay_started", []),
      totals(fourWeeksBefore, "gameplay_started", []),
      totals(range, "interruption_ended", ["surface", "outcome"]),
    ]);
    const optional = ({ group }) => group.class === "optional" && group.trigger === "system";
    const surfaces = new Map();
    bySurface.forEach(({ group, count }) => {
      const entry = surfaces.get(group.surface) ?? {
        surface: group.surface,
        shown: 0,
        dismissed: 0,
        covered: 0,
      };
      entry.shown += count;
      if (group.outcome === "dismissed") entry.dismissed += count;
      if (group.outcome === "covered") entry.covered += count;
      surfaces.set(group.surface, entry);
    });
    return {
      visits,
      optionalShown: sum(ended, optional),
      visitsWithThreeOrMore: sum(
        counted,
        ({ group }) => group.scope === "visit" && ["3-5", "6+"].includes(group.optional),
      ),
      games: sum(counted, ({ group }) => group.scope === "game"),
      optionalDuringPlay: sum(ended, (row) => optional(row) && row.group.phase === "playing"),
      blockingOptionalDuringPlay: sum(
        ended,
        (row) => optional(row) && row.group.phase === "playing" && row.group.blocking === true,
      ),
      firstMoveP75: first[0]?.timings?.since_load_ms?.p75,
      firstMoveN: first[0]?.timings?.since_load_ms?.n ?? 0,
      firstMoveP75Before: firstBefore[0]?.timings?.since_load_ms?.p75,
      firstMoveNBefore: firstBefore[0]?.timings?.since_load_ms?.n ?? 0,
      presses,
      rageAndDead: rage + dead,
      surfaces: [...surfaces.values()].sort((a, b) => b.shown - a.shown),
    };
  }

  /** Each line's value as it may leave: the parts and wholes of shares are checked, counts hidden when small. */
  function shownBudget(raw) {
    const coloured = colourBudget({
      ...raw,
      // A p75 of fewer than 5 values says nothing, so it is not compared.
      firstMoveP75: raw.firstMoveN >= 5 ? raw.firstMoveP75 : undefined,
      firstMoveP75Before: raw.firstMoveNBefore >= 5 ? raw.firstMoveP75Before : undefined,
    });
    const values = {
      optional_per_visit: shareOrHidden(raw.optionalShown, raw.visits),
      visits_with_three_or_more: shareOrHidden(raw.visitsWithThreeOrMore, raw.visits),
      optional_per_game_during_play: shareOrHidden(raw.optionalDuringPlay, raw.games),
      blocking_optional_during_play: hideSmall(raw.blockingOptionalDuringPlay),
      first_move_p75_slower: Number.isFinite(coloured.lines[4].value) ? round(coloured.lines[4].value) : null,
      rage_and_dead_per_100_presses: shareOrHidden(raw.rageAndDead * 100, raw.presses),
    };
    return {
      lines: coloured.lines.map(({ measure, colour }) => ({ measure, value: values[measure], colour })),
      surfaces: coloured.surfaces.map(({ surface, shown, dismissed, covered }) => {
        const raws = raw.surfaces.find((entry) => entry.surface === surface);
        return {
          surface,
          shown: hideSmall(shown),
          dismissed: { value: shareOrHidden(raws.dismissed, shown), colour: dismissed.colour },
          covered: { value: shareOrHidden(raws.covered, shown), colour: covered.colour },
        };
      }),
    };
  }

  const worstColour = (budget) => {
    const colours = [
      ...budget.lines.map(({ colour }) => colour),
      ...budget.surfaces.flatMap(({ dismissed, covered }) => [dismissed.colour, covered.colour]),
    ];
    if (colours.includes(BUDGET_COLOURS.RED)) return BUDGET_COLOURS.RED;
    return colours.includes(BUDGET_COLOURS.AMBER) ? BUDGET_COLOURS.AMBER : BUDGET_COLOURS.NONE;
  };

  async function interruptions(range, before) {
    const [now, then] = await Promise.all([budgetTotals(range), budgetTotals(before)]);
    const shownNow = shownBudget(now);
    const shownThen = shownBudget(then);
    return {
      minShown: SURFACE_MIN_SHOWN,
      lines: shownNow.lines.map((line, index) => ({ ...line, before: shownThen.lines[index].value })),
      surfaces: shownNow.surfaces.slice(0, TOP_HOTSPOTS),
      worst: worstColour(shownNow),
    };
  }

  // 7. The Week view (CC-313 section 8).
  async function week(range, before) {
    const budget = await interruptions(range, before);
    const [
      outcomes,
      shownFor,
      phases,
      perScope,
      textWords,
      textFold,
      byInterruptions,
      byEntry,
      deadBySurface,
      rageBySurface,
    ] = await Promise.all([
      totals(range, "interruption_ended", ["surface", "outcome"]),
      totals(range, "interruption_ended", ["surface", "shown_ms"]),
      totals(range, "interruption_ended", ["surface", "phase"]),
      totals(range, "interruption_counted", ["scope", "device", "optional"]),
      totals(range, "screen_text_measured", ["route", "words"]),
      totals(range, "screen_text_measured", ["route", "fold_words"]),
      totals(range, "gameplay_started", ["interruptions_before"]),
      totals(range, "gameplay_started", ["entry"]),
      totals(range, "dead_clicked", ["surface"]),
      totals(range, "rage_clicked", ["surface"]),
    ]);
    const surfaceIds = [...new Set(outcomes.map(({ group }) => group.surface))];
    const shownOf = (surface) => sum(outcomes, ({ group }) => group.surface === surface);
    const medianBucket = (surface) => {
      const rows = shownFor.filter(({ group }) => group.surface === surface);
      const total = sum(rows);
      if (total < 5) return FEWER_THAN_MIN;
      let seen = 0;
      for (const label of TELEMETRY_BUCKETS.SHOWN_MS) {
        seen += sum(rows, ({ group }) => group.shown_ms === label);
        if (seen >= Math.ceil(total / 2)) return label;
      }
      return FEWER_THAN_MIN;
    };
    const mix = (rows, surface, field) =>
      Object.fromEntries(
        rows
          .filter(({ group }) => group.surface === surface)
          .map(({ group, count }) => [group[field], shareOrHidden(count, shownOf(surface))]),
      );
    const hotspots = await clicks(range, before);
    const funnelsNow = await funnels(range, before);
    return {
      range,
      before,
      budget,
      badge: budget.worst,
      surfaces: surfaceIds
        .sort((a, b) => shownOf(b) - shownOf(a))
        .slice(0, TOP_HOTSPOTS)
        .map((surface) => ({
          surface,
          ticket: surfaceNamed(surface).ticket,
          shown: hideSmall(shownOf(surface)),
          outcomes: mix(outcomes, surface, "outcome"),
          medianShown: medianBucket(surface),
          phases: mix(phases, surface, "phase"),
        })),
      perVisitAndGame: perScope.map(({ group, count }) => ({
        scope: group.scope,
        device: group.device,
        optional: group.optional,
        count: hideSmall(count),
      })),
      text: {
        budgets: TEXT_BUDGETS,
        overBudgetToday: OVER_BUDGET_TODAY,
        lastMeasured: TEXT_LAST_MEASURED,
        runtime: [
          ...textWords.map(({ group, count }) => ({
            route: group.route,
            measure: "words",
            bucket: group.words,
            count: hideSmall(count),
          })),
          ...textFold.map(({ group, count }) => ({
            route: group.route,
            measure: "fold_words",
            bucket: group.fold_words,
            count: hideSmall(count),
          })),
        ],
      },
      firstMove: {
        byEntry: byEntry.map(({ group, count, timings }) => ({
          entry: group.entry,
          games: hideSmall(count),
          p75: percentile(timings?.since_load_ms),
        })),
        byInterruptionsBefore: byInterruptions.map(({ group, count, timings }) => ({
          interruptionsBefore: group.interruptions_before,
          games: hideSmall(count),
          p75: percentile(timings?.since_load_ms),
        })),
      },
      hotspots: {
        dead: hotspots.deadHotspots,
        rage: hotspots.rageHotspots,
        bySurface: [
          ...deadBySurface
            .filter(({ group }) => group.surface !== null)
            .map(({ group, count }) => ({ kind: "dead", surface: group.surface, count: hideSmall(count) })),
          ...rageBySurface
            .filter(({ group }) => group.surface !== null)
            .map(({ group, count }) => ({ kind: "rage", surface: group.surface, count: hideSmall(count) })),
        ],
      },
      funnels: funnelsNow.registered,
      // CC-313 section 7 (the flag side) was cut, so no event says which side of a flag it came from yet.
      flagGuardrails: [],
    };
  }
  const SECTION_WORK = Object.freeze({ funnels, clicks, errors, speed, latency, interruptions, week });

  return Object.freeze({
    defaultRange: () => defaultRange(now()),
    lastFullWeek: () => lastFullWeekOf(now()),

    /**
     * One section of the page for a range, against the range before it, cached 5 minutes per section and range.
     *
     * @param {{ section: string, range: { from: string, to: string } }} query  `badge` and `week` read the week
     */
    get({ section, range }) {
      const at = now();
      const key = `${section}|${range.from}|${range.to}`;
      return cache.remember({
        key,
        now: at,
        make: async () => {
          const before = rangeBefore(range);
          if (section === "badge") {
            const { worst } = await interruptions(range, before);
            return { section, range, badge: worst, generatedAt: at };
          }
          return { section, range, before, generatedAt: at, ...(await SECTION_WORK[section](range, before)) };
        },
      });
    },
  });
}
