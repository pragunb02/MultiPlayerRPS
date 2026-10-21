import { Card } from "../../components/Card/Card.jsx";
import { Section } from "../../components/Page/Page.jsx";
import { ChartFigure } from "./charts.jsx";
import { formatCls, formatCount, formatMs, FEWER_THAN_MIN, NO_DATA_TEXT } from "./format.js";
import { ColourBadge } from "./UxBadge.jsx";
import {
  BUDGET_GREEN,
  BUDGET_LABELS,
  changeWords,
  DEVICE_LABELS,
  ENTRY_LABELS,
  EVENT_LABELS,
  formatBudgetValue,
  formatRatio,
  FUNNEL_TITLES,
  routeName,
  SPEED_LABELS,
  STEP_LABELS,
} from "./uxText.js";
import consoleStyles from "./AdminPage.module.css";

// The sections of the owner's UX page (CC-177). Each takes one section of `GET /api/admin/ux` and draws it as titled
// sections of headline numbers and tables, each table with its unit, its window and a CSV export. Every value
// arrives with "<5" already applied by the server, and is shown as text.

const RATIO_NOTE =
  "A ratio of daily totals, not a conversion: no id joins one visit's steps, so a reload counts a landing twice. Capped at 100 %.";

const windowOf = ({ range, before }) =>
  `From ${range.from} to ${range.to}, India time, against ${before.from} to ${before.to}.`;

/** An arrow for the direction of a change. The words beside it carry the meaning, so it is hidden from readers. */
function Direction({ change }) {
  if (change.startsWith("+")) return <span aria-hidden="true">▲ </span>;
  if (change.startsWith("−")) return <span aria-hidden="true">▼ </span>;
  return null;
}

/** One headline number with the period before and the change. */
export function Headline({ label, value, note, previous, change = "" }) {
  return (
    <Card as="div" className={consoleStyles.tile}>
      <dt className={consoleStyles.tileLabel}>{label}</dt>
      <dd className={consoleStyles.tileValue}>{value}</dd>
      <dd className={consoleStyles.tileNote}>{note}</dd>
      {previous !== undefined && (
        <dd className={consoleStyles.tileBefore}>
          Before: {previous}
          {change !== "" && (
            <>
              {" "}
              (<Direction change={change} />
              {change})
            </>
          )}
        </dd>
      )}
    </Card>
  );
}

/** A titled section of headline numbers. */
export function Headlines({ title, description, children }) {
  return (
    <Section title={title} description={description}>
      <dl className={consoleStyles.tiles}>{children}</dl>
    </Section>
  );
}

/** A table of the page, as a titled figure with its unit, window and CSV export. */
export function UxTable({ id, title, unit, note, columns, rows, range }) {
  return (
    <ChartFigure
      id={`ux.${id}`}
      title={title}
      unit={unit}
      note={note}
      columns={columns}
      rows={rows}
      range={range}
      tableOnly
    />
  );
}

const text = (label, value) => ({ label, value });
const count = (label, value) => ({ label, value, format: "count" });

// 1. Funnels

/** One funnel's steps: each total, the period before, the change and the ratio to the step before. */
function FunnelTable({ funnel, range, registered = false }) {
  const columns = [
    text("Step", (step) => STEP_LABELS[step.id] ?? step.id),
    ...(registered ? [text("Ticket", (step) => step.ticket)] : []),
    count("Total", (step) => step.now),
    count("Before", (step) => step.before),
    text("Change", (step) => changeWords(step.change)),
    text("Ratio to the step before", (step) => formatRatio(step)),
    ...(registered ? [text("New", (step) => (step.isNew ? "New" : ""))] : []),
  ];
  return (
    <UxTable
      id={`funnel.${funnel.id}`}
      title={`${FUNNEL_TITLES[funnel.id] ?? funnel.id}${registered ? ", step by step" : ""}`}
      unit="events reached"
      note={RATIO_NOTE}
      columns={columns}
      rows={funnel.steps}
      range={range}
    />
  );
}

/** The step funnels CC-313 registers: drop-off per step, a step new in this period marked. */
export function RegisteredFunnels({ funnels, range }) {
  return funnels.map((funnel) => <FunnelTable key={funnel.id} funnel={funnel} range={range} registered />);
}

/** @param {{ report: object }} props */
export function Funnels({ report }) {
  const { range } = report;
  const last = (funnel) => funnel.steps.at(-1);
  return (
    <>
      <Headlines title="Headline ratios" description={windowOf(report)}>
        {report.funnels.map((funnel) => (
          <Headline
            key={funnel.id}
            label={FUNNEL_TITLES[funnel.id]}
            value={formatCount(last(funnel).now)}
            note={`${STEP_LABELS[last(funnel).id]}, ${formatRatio(last(funnel))} of the step before`}
            previous={formatCount(last(funnel).before)}
            change={changeWords(last(funnel).change)}
          />
        ))}
      </Headlines>
      <Section
        title="The three funnels"
        description="Each step's daily totals over the range, and its ratio to the step before."
      >
        {report.funnels.map((funnel) => (
          <FunnelTable key={funnel.id} funnel={funnel} range={range} />
        ))}
        <UxTable
          id="funnel.by_entry"
          title="Visit to play by entry"
          unit="landings and first moves"
          note={RATIO_NOTE}
          columns={[
            text("Entry", (row) => ENTRY_LABELS[row.entry] ?? row.entry),
            count("Landings", (row) => row.landings),
            count("First moves", (row) => row.firstMoves),
            text("Ratio", (row) => (row.ratio === FEWER_THAN_MIN ? "fewer than 5" : formatRatio(row))),
          ]}
          rows={report.byEntry}
          range={range}
        />
        <UxTable
          id="funnel.rejected"
          title="Sign-up form refusals"
          unit="refusals by the form's own checks"
          columns={[
            text("Field", (row) => row.field),
            text("Rule", (row) => row.rule.replace(/_/g, " ")),
            count("Refusals", (row) => row.count),
          ]}
          rows={report.rejected}
          range={range}
        />
      </Section>
      <Section
        title="Registered step funnels"
        description="The steps each flow registers (CC-313), with the drop-off between them."
      >
        <RegisteredFunnels funnels={report.registered} range={range} />
      </Section>
    </>
  );
}

// 2. Clicks

const targetOf = (row) => `${row.target} (${row.by})`;

/** Dead or rage click hotspots: the top 10 by route and control, each with its share of the route's presses. */
export function HotspotTable({ id, title, rows, range }) {
  return (
    <UxTable
      id={id}
      title={title}
      unit="clicks"
      note="Share of the screen's presses, so a control everyone uses does not top the list by size alone."
      columns={[
        text("Screen", (row) => routeName(row.route)),
        text("Control or element", targetOf),
        count("Clicks", (row) => row.count),
        { label: "Share of the screen's presses", value: (row) => row.share, format: "share" },
      ]}
      rows={rows}
      range={range}
    />
  );
}

/** @param {{ report: object }} props */
export function Clicks({ report }) {
  const { range } = report;
  const tile = (label, value, note) => (
    <Headline
      label={label}
      value={formatCount(value.now)}
      note={note}
      previous={formatCount(value.before)}
      change={changeWords(value.change)}
    />
  );
  return (
    <>
      <Headlines title="Headline numbers" description={windowOf(report)}>
        {tile("Presses", report.presses, "Presses on a named control")}
        {tile("Dead clicks", report.dead, "A press that did nothing")}
        {tile("Rage clicks", report.rage, "3 or more presses in 0.7 s")}
        <Headline
          label="Rage and dead per 100 presses"
          value={formatBudgetValue("rage_and_dead_per_100_presses", report.per100Presses.now)}
          note="The budget's line is 1 or less"
          previous={formatBudgetValue("rage_and_dead_per_100_presses", report.per100Presses.before)}
        />
      </Headlines>
      <Section title="Hotspots" description="The 10 busiest by screen and control, dead clicks first.">
        <HotspotTable id="clicks.dead" title="Dead click hotspots" rows={report.deadHotspots} range={range} />
        <HotspotTable id="clicks.rage" title="Rage click hotspots" rows={report.rageHotspots} range={range} />
      </Section>
    </>
  );
}

// 3. Errors

const perPages = (row) => {
  const shown = formatCount(row.count);
  return typeof row.per100Pages === "number" ? `${shown} (${row.per100Pages} per 100 pages)` : shown;
};

/** @param {{ report: object }} props */
export function Errors({ report }) {
  const { range, events, builds } = report;
  const days = events[0]?.byDay.map(({ day }) => day) ?? [];
  return (
    <>
      <Headlines title="Headline numbers" description={windowOf(report)}>
        {events.map((row) => (
          <Headline
            key={row.event}
            label={EVENT_LABELS[row.event]}
            value={formatCount(row.now)}
            note="In the range"
            previous={formatCount(row.before)}
            change={changeWords(row.change)}
          />
        ))}
      </Headlines>
      <Section
        title="By day and by build"
        description="Each kind of error per India day, and over the last 5 builds side by side."
      >
        <UxTable
          id="errors.by_day"
          title="Errors by day"
          unit="errors"
          columns={[
            text("Day", (day) => day),
            ...events.map((row) =>
              count(EVENT_LABELS[row.event], (day) => row.byDay.find((each) => each.day === day)?.count ?? 0),
            ),
          ]}
          rows={days}
          range={range}
        />
        <UxTable
          id="errors.by_build"
          title="Errors by build"
          unit="errors, and per 100 pages viewed on that build"
          columns={[
            text("What", (row) => EVENT_LABELS[row.event]),
            ...builds.map((build) =>
              text(build, (row) => {
                const cell = row.byBuild.find((each) => each.build === build);
                return cell === undefined ? NO_DATA_TEXT : perPages(cell);
              }),
            ),
          ]}
          rows={events}
          range={range}
        />
      </Section>
      <Section
        title="The most common"
        description="The 10 most common of each, by kind and code. No message or stack is ever kept."
      >
        <UxTable
          id="errors.client"
          title="Errors in the browser"
          unit="errors"
          columns={[
            text("Kind", (row) => row.kind),
            text("Type", (row) => row.error_type),
            count("Errors", (row) => row.count),
          ]}
          rows={report.clientErrors}
          range={range}
        />
        <UxTable
          id="errors.requests"
          title="Requests that failed"
          unit="requests"
          columns={[
            text("Address", (row) => row.endpoint),
            text("Code", (row) => row.code),
            count("Requests", (row) => row.count),
          ]}
          rows={report.failedRequests}
          range={range}
        />
        <UxTable
          id="errors.server"
          title="Server errors"
          unit="errors"
          columns={[
            text("Operation", (row) => row.operation),
            text("Code", (row) => row.code),
            count("Errors", (row) => row.count),
          ]}
          rows={report.serverErrors}
          range={range}
        />
      </Section>
    </>
  );
}

// 4. Speed

const SPEED_SHOWN = Object.freeze(["lcp_ms", "inp_ms", "cls", "ttfb_ms"]);
const speedValue = (field, value) => (field === "cls" ? formatCls(value) : formatMs(value));
/** A p75 with its judgement against the line, in words, so the colour is never alone. */
const judged = (row, field) => {
  const value = speedValue(field, row.p75[field]);
  const good = row.good[field];
  return good === null || good === undefined ? value : `${value}, ${good ? "good" : "over"}`;
};
const speedColumns = (first) => [
  ...first,
  count("Pages", (row) => row.pages),
  ...SPEED_SHOWN.map((field) => text(`${SPEED_LABELS[field]} p75`, (row) => judged(row, field))),
];

/** @param {{ report: object }} props */
export function Speed({ report }) {
  const { range, lines, overall, firstMove } = report;
  return (
    <>
      <Headlines title="Headline p75" description={`${windowOf(report)} Judged against the lines below.`}>
        {SPEED_SHOWN.map((field) => (
          <Headline
            key={field}
            label={SPEED_LABELS[field]}
            value={judged(overall.now, field)}
            note={`Good at ${speedValue(field, lines[field].line)} or less`}
            previous={speedValue(field, overall.before.p75[field])}
          />
        ))}
        <Headline
          label="Time to first move"
          value={formatMs(firstMove.now)}
          note={`Target ${formatMs(firstMove.target)} or less`}
          previous={formatMs(firstMove.before)}
        />
      </Headlines>
      <Section
        title="Against the lines"
        description="Each page timing at p75, the 75th percentile, on phones and desktops."
      >
        <UxTable
          id="speed.lines"
          title="The lines"
          unit="the good line at p75"
          note="Core Web Vitals' good lines (web.dev), or GROWTH 2.5's budget where it is stricter. A range's p75 is read from the daily bucket counters, so it is never better than the true one."
          columns={[
            text("Timing", (field) => SPEED_LABELS[field]),
            text("Core Web Vitals", (field) => speedValue(field, lines[field].cwv)),
            text("GROWTH 2.5", (field) =>
              lines[field].growth === undefined ? "none" : speedValue(field, lines[field].growth),
            ),
            text("Judged against", (field) => speedValue(field, lines[field].line)),
          ]}
          rows={Object.keys(lines)}
          range={range}
        />
        <UxTable
          id="speed.by_route"
          title="Page speed by screen and device"
          unit="page loads"
          columns={speedColumns([
            text("Screen", (row) => routeName(row.route)),
            text("Device", (row) => DEVICE_LABELS[row.device] ?? row.device),
          ])}
          rows={report.byRouteDevice}
          range={range}
        />
        <UxTable
          id="speed.by_build"
          title="Page speed by build"
          unit="page loads"
          columns={speedColumns([text("Build", (row) => row.build)])}
          rows={report.byBuild}
          range={range}
        />
      </Section>
      <Section
        title="Time to first move"
        description="From the page load to the first move sent, at p75, by how the visit arrived."
      >
        <UxTable
          id="speed.first_move"
          title="Time to first move by entry"
          unit="first moves"
          columns={[
            text("Entry", (row) => ENTRY_LABELS[row.entry] ?? row.entry),
            count("First moves", (row) => row.games),
            { label: "p75", value: (row) => row.p75, format: "ms" },
          ]}
          rows={firstMove.byEntry}
          range={range}
        />
      </Section>
    </>
  );
}

// 5. Latency

/** @param {{ report: object }} props */
export function Latency({ report }) {
  const { range } = report;
  return (
    <Section title="Press to answer" description={windowOf(report)}>
      <UxTable
        id="latency.controls"
        title="Wait per control"
        unit="presses that waited for an answer"
        note="The server's own timings are in Grafana (ADR-055). This is what the player feels, network included."
        columns={[
          text("Control", (row) => row.control),
          count("Presses", (row) => row.presses),
          { label: "p50", value: (row) => row.p50, format: "ms" },
          { label: "p95", value: (row) => row.p95, format: "ms" },
        ]}
        rows={report.controls}
        range={range}
      />
      <UxTable
        id="latency.outcomes"
        title="How the waits ended"
        unit="presses"
        columns={[text("Outcome", (row) => row.outcome), count("Presses", (row) => row.count)]}
        rows={report.outcomes}
        range={range}
      />
    </Section>
  );
}

// 6. Interruptions

/** The colour of a line as a badge: a word on its colour, never the colour alone. */
const colourCell = (colour) => <ColourBadge colour={colour} />;

/** The interruption budget (CC-313 section 5) with its colours and the period before. */
export function BudgetTable({ budget, range }) {
  return (
    <ChartFigure
      id="ux.budget"
      title="The interruption budget"
      unit="the budget's measures"
      note="Only optional surfaces the site opened by itself count. A line or share from fewer than 5 gets no colour."
      columns={[
        text("Measure", (line) => BUDGET_LABELS[line.measure]),
        text("Now", (line) => formatBudgetValue(line.measure, line.value)),
        text("Green at", (line) => BUDGET_GREEN[line.measure]),
        text("Before", (line) => formatBudgetValue(line.measure, line.before)),
        text("Colour", (line) => line.colour),
      ]}
      rows={budget.lines}
      range={range}
      tableOnly
      cells={{ Colour: (line) => colourCell(line.colour) }}
    />
  );
}

/** Each surface's dismissed and covered shares, judged once it was shown 50 times. */
export function SurfaceShares({ budget, range }) {
  return (
    <ChartFigure
      id="ux.surfaces"
      title="Dismissed and covered, by surface"
      unit="times shown"
      note={`Judged once a surface was shown at least ${budget.minShown} times: dismissed amber over 50 %, red over 70 %; covered amber over 2 %, red over 5 %.`}
      columns={[
        text("Surface", (row) => row.surface),
        count("Shown", (row) => row.shown),
        { label: "Dismissed", value: (row) => row.dismissed.value, format: "share" },
        text("Dismissed colour", (row) => row.dismissed.colour),
        { label: "Covered", value: (row) => row.covered.value, format: "share" },
        text("Covered colour", (row) => row.covered.colour),
      ]}
      rows={budget.surfaces}
      range={range}
      tableOnly
      cells={{
        "Dismissed colour": (row) => colourCell(row.dismissed.colour),
        "Covered colour": (row) => colourCell(row.covered.colour),
      }}
    />
  );
}

/** @param {{ report: object }} props */
export function Interruptions({ report }) {
  return (
    <Section
      title="The interruption budget"
      description={`${windowOf(report)} The worst line is ${report.worst === "none" ? "not coloured" : report.worst}.`}
      actions={<ColourBadge colour={report.worst} context="the worst line" />}
    >
      <BudgetTable budget={report} range={report.range} />
      <SurfaceShares budget={report} range={report.range} />
    </Section>
  );
}
