import { Section } from "../../components/Page/Page.jsx";
import { BarChart, ChartFigure } from "./charts.jsx";
import { formatCount } from "./format.js";
import styles from "./AdminPage.module.css";

// The Statuses page of the owner console (ADR-034 point 4, CC-255): what kind of players the site had each week,
// and how they moved between kinds. The server works every status out per India day. The rules are in
// docs/tickets/CC-255.md, and the short version is on the page.

/** Each status's name on screen, in the order the server lists them. */
const STATUS_NAMES = Object.freeze({
  notYet: "Not playing yet",
  new: "New",
  casual: "Casual",
  regular: "Regular",
  core: "Core",
  returning: "Returning",
  lapsing: "Lapsing",
  dormant: "Dormant",
});

/** The rules, as the owner decided them (ADR-034). */
const RULES = Object.freeze([
  ["New", "first game ever in the last 7 days"],
  ["Casual", "played 1 day of the last 7"],
  ["Regular", "played 2 or 3 days of the last 7"],
  ["Core", "played 4 or more days of the last 7"],
  ["Returning", "played today after 14 or more days without a game"],
  ["Lapsing", "last game 8 to 14 days back"],
  ["Dormant", "last game 15 or more days back"],
]);

/** The statuses drawn as bars, each a lasting state on the week's last day. */
const SERIES = Object.freeze([
  { key: "new", label: "New", tone: "gold" },
  { key: "casual", label: "Casual", tone: "xp" },
  { key: "regular", label: "Regular", tone: "primary" },
  { key: "core", label: "Core", tone: "accent" },
  { key: "lapsing", label: "Lapsing", tone: "chess" },
]);

const WEEK_COLUMNS = Object.freeze([
  { label: "Week from", value: (row) => row.week },
  { label: "Last day", value: (row) => row.through },
  ...SERIES.map(({ key, label }) => ({ label, value: (row) => row[key], format: "count" })),
  { label: "Came back", value: (row) => row.cameBack, format: "count" },
  { label: "Went dormant", value: (row) => row.wentDormant, format: "count" },
  { label: "Regular and Core (North Star)", value: (row) => row.northStar, format: "count" },
  { label: "Week over", value: (row) => (row.complete ? "yes" : "not yet") },
]);

/** The summary a screen reader hears instead of the weekly chart. */
function summaryOf(weeks) {
  if (weeks.length === 0) {
    return "Players by status on the last day of each week. No week of this period has started yet.";
  }
  const most = Math.max(
    0,
    ...weeks.flatMap((row) => SERIES.map(({ key }) => row[key]).filter((value) => typeof value === "number")),
  );
  return `Players by status on the last day of each week, ${weeks.length} bars from ${weeks[0].week} to ${weeks[weeks.length - 1].week}. Highest ${formatCount(most)}. The same numbers are in the table below.`;
}

/**
 * The Statuses page: the rules, the weekly trend with the North Star, and the moves of the headline week.
 *
 * @param {{ report: object }} props
 */
export function Statuses({ report }) {
  const { range } = report;
  const { weeks, moves } = report.statuses;
  const statuses = Object.keys(moves.rows[0].to);
  return (
    <>
      <Section
        title="How a status is worked out"
        description="Each India day, from the matches that counted for a player, guests and accounts alike. Today is day 1, so the last 7 days are today and the 6 before. The first rule that fits wins."
      >
        <ul className={styles.list}>
          {RULES.map(([name, rule]) => (
            <li key={name}>
              <strong>{name}</strong>: {rule}.
            </li>
          ))}
        </ul>
      </Section>
      <ChartFigure
        id="player-statuses"
        unit="players"
        title="Player statuses by week"
        note="Statuses on the last day of each week, Monday to Sunday, or today for a week still going on. Came back and went dormant count the whole week. Regular plus Core is the North Star. Players who stayed dormant are not counted."
        range={range}
        rows={weeks}
        columns={WEEK_COLUMNS}
      >
        <BarChart
          summary={summaryOf(weeks)}
          rows={weeks.map((row) => ({
            label: row.week,
            values: Object.fromEntries(SERIES.map(({ key }) => [key, row[key]])),
          }))}
          series={SERIES}
        />
      </ChartFigure>
      <ChartFigure
        id="status-moves"
        unit="players"
        title="Moves between statuses"
        note={`Each player's status from Sunday ${moves.from} to Sunday ${moves.to}, the full week from ${moves.week}. Rows are where they came from, columns where they went. Players who stayed dormant are never read, so that cell is not counted.`}
        range={range}
        tableOnly
        rows={moves.rows}
        columns={[
          { label: "From", value: (row) => STATUS_NAMES[row.from] },
          ...statuses.map((status) => ({
            label: STATUS_NAMES[status],
            value: (row) => row.to[status],
            format: "count",
          })),
        ]}
      />
    </>
  );
}
