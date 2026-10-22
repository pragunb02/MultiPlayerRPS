/**
 * The interruption budget (CC-313 section 5, owner 2026-10-20: the recommended column). Pure: the nightly totals
 * (CC-176) give a day's or a week's totals, and this gives each line its colour. The colours are worked out on exact
 * totals, but anything shown keeps ADR-036.2: a total under 5 is shown as `"<5"` by the console, and a share of fewer
 * than 5 gets no colour here.
 */

export const BUDGET_COLOURS = Object.freeze({ GREEN: "green", AMBER: "amber", RED: "red", NONE: "none" });

/** The smallest total a share or a mean may be worked out of (ADR-036.2). */
export const SMALLEST_BASE = 5;
/** A single surface is judged only once it was shown this often in the 7 days (owner, 2026-10-20). */
export const SURFACE_MIN_SHOWN = 50;

/**
 * Each line's thresholds: green up to `green`, amber up to `amber`, red above. Shares are fractions.
 */
export const BUDGET_LINES = Object.freeze({
  optionalPerVisit: Object.freeze({ green: 0.5, amber: 1.0 }),
  visitsWithThreeOrMore: Object.freeze({ green: 0.05, amber: 0.1 }),
  optionalPerGame: Object.freeze({ green: 0.05, amber: 0.2 }),
  surfaceDismissed: Object.freeze({ green: 0.5, amber: 0.7 }),
  surfaceCovered: Object.freeze({ green: 0.02, amber: 0.05 }),
  firstMoveSlower: Object.freeze({ green: 0.1, amber: 0.25 }),
  rageAndDeadPer100: Object.freeze({ green: 1, amber: 3 }),
});
/** Blocking optional interruptions during play: none is green, a day with 5 or more is red. */
export const BLOCKING_DURING_PLAY_RED = 5;

const { AMBER, GREEN, NONE, RED } = BUDGET_COLOURS;

/** The colour of a value against a line, or none when its base is too small to say. */
function colourOf(value, line, base, smallest = SMALLEST_BASE) {
  if (base < smallest || !Number.isFinite(value)) return NONE;
  if (value <= line.green) return GREEN;
  return value <= line.amber ? AMBER : RED;
}

/**
 * @typedef {Object} BudgetTotals   one India day's or week's totals (CC-176)
 * @property {number} visits                       `visit_ended`
 * @property {number} optionalShown                `interruption_ended` with class optional and trigger system
 * @property {number} visitsWithThreeOrMore        `interruption_counted` visits with an `optional` of `3-5` or `6+`
 * @property {number} games                        `interruption_counted` games
 * @property {number} optionalDuringPlay           optional, system opened, phase playing
 * @property {number} blockingOptionalDuringPlay   the same, blocking
 * @property {number | undefined} firstMoveP75     `gameplay_started.since_load_ms` p75
 * @property {number | undefined} firstMoveP75Before   the same over the 4 weeks before
 * @property {number} presses                      `control_pressed`
 * @property {number} rageAndDead                  `rage_clicked` plus `dead_clicked`
 * @property {ReadonlyArray<{ surface: string, shown: number, dismissed: number, covered: number }>} surfaces
 */

/**
 * Every line of the budget with its value and colour, and each surface's dismissed and covered shares.
 *
 * @param {Readonly<BudgetTotals>} totals
 */
export function colourBudget(totals) {
  const ratio = (part, whole) => (whole > 0 ? part / whole : Number.NaN);
  const { firstMoveP75: now, firstMoveP75Before: before } = totals;
  const slower = now !== undefined && before !== undefined && before > 0 ? now / before - 1 : Number.NaN;
  const blocking = totals.blockingOptionalDuringPlay;
  const blockingColour = blocking === 0 ? GREEN : blocking >= BLOCKING_DURING_PLAY_RED ? RED : NONE;
  const line = (measure, value, colour) => Object.freeze({ measure, value, colour });

  return Object.freeze({
    lines: Object.freeze([
      line(
        "optional_per_visit",
        ratio(totals.optionalShown, totals.visits),
        colourOf(ratio(totals.optionalShown, totals.visits), BUDGET_LINES.optionalPerVisit, totals.visits),
      ),
      line(
        "visits_with_three_or_more",
        ratio(totals.visitsWithThreeOrMore, totals.visits),
        colourOf(
          ratio(totals.visitsWithThreeOrMore, totals.visits),
          BUDGET_LINES.visitsWithThreeOrMore,
          totals.visits,
        ),
      ),
      line(
        "optional_per_game_during_play",
        ratio(totals.optionalDuringPlay, totals.games),
        colourOf(ratio(totals.optionalDuringPlay, totals.games), BUDGET_LINES.optionalPerGame, totals.games),
      ),
      line("blocking_optional_during_play", blocking, blockingColour),
      line(
        "first_move_p75_slower",
        slower,
        colourOf(slower, BUDGET_LINES.firstMoveSlower, Number.isFinite(slower) ? SMALLEST_BASE : 0),
      ),
      line(
        "rage_and_dead_per_100_presses",
        ratio(totals.rageAndDead * 100, totals.presses),
        colourOf(
          ratio(totals.rageAndDead * 100, totals.presses),
          BUDGET_LINES.rageAndDeadPer100,
          totals.presses,
        ),
      ),
    ]),
    surfaces: Object.freeze(
      totals.surfaces.map(({ surface, shown, dismissed, covered }) =>
        Object.freeze({
          surface,
          shown,
          dismissed: line(
            "dismissed",
            ratio(dismissed, shown),
            colourOf(ratio(dismissed, shown), BUDGET_LINES.surfaceDismissed, shown, SURFACE_MIN_SHOWN),
          ),
          covered: line(
            "covered",
            ratio(covered, shown),
            colourOf(ratio(covered, shown), BUDGET_LINES.surfaceCovered, shown, SURFACE_MIN_SHOWN),
          ),
        }),
      ),
    ),
  });
}
