import { Section } from "../../components/Page/Page.jsx";
import { EmptyState } from "../../components/States/States.jsx";
import { FEWER_THAN_MIN_TEXT, formatCount } from "./format.js";
import { ColourBadge } from "./UxBadge.jsx";
import { BudgetTable, HotspotTable, RegisteredFunnels, SurfaceShares, UxTable } from "./UxPanel.jsx";
import { DEVICE_LABELS, ENTRY_LABELS, routeName } from "./uxText.js";
import styles from "./UxPage.module.css";

// The weekly UX report (CC-313 section 8): the last full India week, Monday to Sunday, against the week before. The
// sections are the ticket's eight, in its order. Every number arrives with "<5" applied by the server.

const OUTCOMES = Object.freeze([
  ["acted", "Acted"],
  ["dismissed", "Dismissed"],
  ["timed_out", "Timed out"],
  ["covered", "Covered"],
  ["page_left", "Page left"],
]);
const PHASES = Object.freeze({
  before_play: "before play",
  playing: "playing",
  result: "result",
  elsewhere: "elsewhere",
});

const text = (label, value) => ({ label, value });
const count = (label, value) => ({ label, value, format: "count" });
const share = (label, value) => ({ label, value, format: "share" });

/** A mix of shares as words, such as "result 100.0%". */
const mixWords = (mix, names) =>
  Object.entries(mix)
    .map(
      ([key, value]) =>
        `${names[key] ?? key} ${typeof value === "number" ? `${(value * 100).toFixed(1)}%` : FEWER_THAN_MIN_TEXT}`,
    )
    .join(", ");

/**
 * @param {{ report: object }} props
 */
export function UxWeek({ report }) {
  const { range, before, budget } = report;
  const window = `The week from ${range.from} to ${range.to}, India time, against ${before.from} to ${before.to}.`;
  const screens = Object.keys(report.text.budgets);
  return (
    <>
      <Section
        title="1. The interruption budget"
        description={window}
        actions={<ColourBadge colour={report.badge} context="this week's worst line" />}
      >
        <BudgetTable budget={budget} range={range} />
        <SurfaceShares budget={budget} range={range} />
      </Section>
      <Section
        title="2. The surfaces shown most"
        description="The top 10 by times shown, how each ended, how long it showed and when."
      >
        <UxTable
          id="week.surfaces"
          title="Top surfaces"
          unit="times shown"
          columns={[
            text("Surface", (row) => row.surface),
            text("Ticket", (row) => row.ticket),
            count("Shown", (row) => row.shown),
            ...OUTCOMES.map(([key, label]) => share(label, (row) => row.outcomes[key] ?? 0)),
            text("Median time shown", (row) =>
              row.medianShown === "<5" ? FEWER_THAN_MIN_TEXT : row.medianShown,
            ),
            text("Phase", (row) => mixWords(row.phases, PHASES)),
          ]}
          rows={report.surfaces}
          range={range}
        />
      </Section>
      <Section
        title="3. Interruptions per visit and per game"
        description="How many optional interruptions each visit and each game had, by device."
      >
        <UxTable
          id="week.per_visit"
          title="Per visit and per game"
          unit="visits and games"
          columns={[
            text("Scope", (row) => (row.scope === "visit" ? "Visit" : "Game")),
            text("Device", (row) => DEVICE_LABELS[row.device] ?? row.device),
            text("Optional interruptions", (row) => row.optional),
            count("How many", (row) => row.count),
          ]}
          rows={report.perVisitAndGame}
          range={range}
        />
      </Section>
      <Section
        title="4. Text on the key screens"
        description="Words above the fold: the CI budget, its last numbers, and what players saw."
      >
        <UxTable
          id="week.text_budget"
          title="The text budget"
          unit="words above the fold"
          note={`Last measured on ${report.text.lastMeasured.on}. Each pull request's own numbers are in its CI job summary.`}
          columns={[
            text("Screen", (screen) => screen),
            text("Budget", (screen) => {
              const over = report.text.overBudgetToday[screen];
              return over === undefined
                ? String(report.text.budgets[screen])
                : `${report.text.budgets[screen]} (held at ${over.fold})`;
            }),
            text("Phone", (screen) => String(report.text.lastMeasured.fold[screen]?.phone ?? "not measured")),
            text("Laptop", (screen) =>
              String(report.text.lastMeasured.fold[screen]?.laptop ?? "not measured"),
            ),
          ]}
          rows={screens}
          range={range}
        />
        <UxTable
          id="week.text_runtime"
          title="Words players saw"
          unit="screens measured"
          columns={[
            text("Screen", (row) => routeName(row.route)),
            text("Measure", (row) => (row.measure === "words" ? "All of main" : "Above the fold")),
            text("Words", (row) => row.bucket),
            count("Screens", (row) => row.count),
          ]}
          rows={report.text.runtime}
          range={range}
        />
      </Section>
      <Section
        title="5. Time to first move"
        description="At p75, by how the visit arrived and by the optional interruptions before it."
      >
        <UxTable
          id="week.first_move_entry"
          title="By entry"
          unit="first moves"
          columns={[
            text("Entry", (row) => ENTRY_LABELS[row.entry] ?? row.entry),
            count("First moves", (row) => row.games),
            { label: "p75", value: (row) => row.p75, format: "ms" },
          ]}
          rows={report.firstMove.byEntry}
          range={range}
        />
        <UxTable
          id="week.first_move_interruptions"
          title="By interruptions before it"
          unit="first moves"
          columns={[
            text("Interruptions before", (row) => row.interruptionsBefore ?? "not counted"),
            count("First moves", (row) => row.games),
            { label: "p75", value: (row) => row.p75, format: "ms" },
          ]}
          rows={report.firstMove.byInterruptionsBefore}
          range={range}
        />
      </Section>
      <Section
        title="6. Rage and dead click hotspots"
        description="The top hotspots, and the surfaces presses landed in."
      >
        <HotspotTable id="week.dead" title="Dead click hotspots" rows={report.hotspots.dead} range={range} />
        <HotspotTable id="week.rage" title="Rage click hotspots" rows={report.hotspots.rage} range={range} />
        <UxTable
          id="week.by_surface"
          title="Clicks inside a surface"
          unit="clicks"
          columns={[
            text("Kind", (row) => (row.kind === "rage" ? "Rage" : "Dead")),
            text("Surface", (row) => row.surface),
            count("Clicks", (row) => row.count),
          ]}
          rows={report.hotspots.bySurface}
          range={range}
        />
      </Section>
      <Section
        title="7. The registered funnels"
        description="Each step's drop-off as a ratio of daily totals. A step new this week is marked."
      >
        <RegisteredFunnels funnels={report.funnels} range={range} />
      </Section>
      <Section
        title="8. Flags ramping with a friction guardrail"
        description="Each such flag's guardrail with the flag on against off."
      >
        {report.flagGuardrails.length === 0 ? (
          <EmptyState title="No flag to compare yet">
            No event carries a flag side yet: CC-313 section 7 was cut, so this fills once a ramping flag
            sends one.
          </EmptyState>
        ) : (
          <p className={styles.note}>{formatCount(report.flagGuardrails.length)} flags</p>
        )}
      </Section>
    </>
  );
}
