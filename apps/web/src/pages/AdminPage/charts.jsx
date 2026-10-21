import { useId } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { downloadCsv, toCsv } from "../../lib/csv.js";
import { csvValue, drawable, FEWER_THAN_MIN, FORMATS, formatCount, WEEKDAYS } from "./format.js";
import styles from "./charts.module.css";

// Charts for the owner console (CC-233), drawn as SVG with no chart library. Colours come from CSS classes,
// because the content security policy allows no inline styles. Every chart is a picture with a short summary
// for screen readers, followed by the same numbers as a table and an export to CSV.

const WIDTH = 640;
const HEIGHT = 220;
// A few bars on a wide chart stay bars, not blocks.
const MAX_BAR_WIDTH = 48;
const PLOT = Object.freeze({ left: 44, right: 8, top: 12, bottom: 28 });

/**
 * @typedef {{ label: string, value: (row: any) => number | string, format?: keyof typeof FORMATS }} Column
 */

/**
 * The numbers behind a chart as a table, with a scrollable frame on narrow screens.
 *
 * @param {{ caption: string, columns: ReadonlyArray<Column>, rows: ReadonlyArray<any>, cells?: Record<string, (row: any) => import("react").ReactNode> }} props
 *   `cells`: by column label, a cell drawn from the row (such as a colour badge) instead of its formatted value. The
 *   exported file keeps the value
 */
export function DataTable({ caption, columns, rows, cells = {} }) {
  return (
    <div className={styles.tableFrame} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column, place) => {
                const text =
                  cells[column.label]?.(row) ?? FORMATS[column.format ?? "text"](column.value(row));
                return place === 0 ? (
                  <th key={column.label} scope="row">
                    {text}
                  </th>
                ) : (
                  <td key={column.label}>{text}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One chart or table of the console, a titled section of its page (CC-323): a heading, what is counted and over
 * which days, an optional note, the picture, the numbers as a table (open from the start when `tableOnly`) and a
 * button that saves them as CSV. A table with no rows says so instead of drawing an empty table. A chart's own
 * summary says when it has nothing to show.
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   unit: string,
 *   note?: string,
 *   columns: ReadonlyArray<Column>,
 *   rows: ReadonlyArray<any>,
 *   range: { from: string, to: string },
 *   tableOnly?: boolean,
 *   cells?: Record<string, (row: any) => import("react").ReactNode>,
 *   children?: import("react").ReactNode,
 * }} props  `id` names the CSV file and the export button. `unit`: what each number counts, such as "players"
 */
export function ChartFigure({
  id,
  title,
  unit,
  note = "",
  columns,
  rows,
  range,
  tableOnly = false,
  cells = {},
  children,
}) {
  const titleId = useId();
  const exportCsv = () =>
    downloadCsv({
      filename: `classicade-${id}-${range.from}-to-${range.to}.csv`,
      text: toCsv({
        columns: columns.map((column) => ({
          label: column.label,
          value: (row) => csvValue(column.value(row)),
        })),
        rows,
      }),
    });
  return (
    <Card as="figure" className={styles.figure} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {/* The name starts with the words on screen and says which numbers it saves. */}
        <Button
          control={`admin.export.${id}`}
          variant="secondary"
          onClick={exportCsv}
          aria-label={`Export CSV: ${title}`}
        >
          Export CSV
        </Button>
      </div>
      <p className={styles.window}>
        In {unit}, from {range.from} to {range.to}, India time.
      </p>
      {note !== "" && <p className={styles.note}>{note}</p>}
      {tableOnly && rows.length === 0 ? (
        <p className={styles.empty}>Nothing yet in this period.</p>
      ) : tableOnly ? (
        <DataTable caption={title} columns={columns} rows={rows} cells={cells} />
      ) : (
        <>
          {children}
          <details className={styles.details}>
            <summary data-cc-control={`admin.table.${id}`}>Show as a table</summary>
            <DataTable caption={title} columns={columns} rows={rows} cells={cells} />
          </details>
        </>
      )}
    </Card>
  );
}

/**
 * The colour swatches that name a chart's series.
 *
 * @param {{ series: ReadonlyArray<{ key: string, label: string, tone: string }> }} props
 */
function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <ul className={styles.legend}>
      {series.map((item) => (
        <li key={item.key}>
          <span className={`${styles.swatch} ${styles[item.tone]}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Bars over time, one per bucket, stacked by series. A hidden group (fewer than 5) is drawn as a short dashed
 * mark at the bottom, so it is not mistaken for zero.
 *
 * @param {{
 *   summary: string,
 *   rows: ReadonlyArray<{ label: string, values: Record<string, number | string> }>,
 *   series: ReadonlyArray<{ key: string, label: string, tone: string }>,
 * }} props  `summary` is what a screen reader hears instead of the picture
 */
export function BarChart({ summary, rows, series }) {
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const totals = rows.map((row) => series.reduce((sum, item) => sum + drawable(row.values[item.key]), 0));
  const max = Math.max(1, ...totals);
  const slot = plotWidth / Math.max(1, rows.length);
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(1, slot * 0.7));
  const scale = (value) => (value / max) * plotHeight;
  const labelled = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]);
  return (
    <>
      <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary}>
        <line
          className={styles.axis}
          x1={PLOT.left}
          x2={WIDTH - PLOT.right}
          y1={HEIGHT - PLOT.bottom}
          y2={HEIGHT - PLOT.bottom}
        />
        <text className={styles.tick} x={PLOT.left - 6} y={PLOT.top + 4} textAnchor="end">
          {formatCount(max)}
        </text>
        <text className={styles.tick} x={PLOT.left - 6} y={HEIGHT - PLOT.bottom} textAnchor="end">
          0
        </text>
        {rows.map((row, index) => {
          const x = PLOT.left + index * slot + (slot - barWidth) / 2;
          let base = HEIGHT - PLOT.bottom;
          return (
            <g key={row.label}>
              {series.map((item) => {
                const value = row.values[item.key];
                if (value === FEWER_THAN_MIN) {
                  return (
                    <rect
                      key={item.key}
                      className={styles.hidden}
                      x={x}
                      y={base - 3}
                      width={barWidth}
                      height={3}
                    />
                  );
                }
                const height = scale(drawable(value));
                base -= height;
                return (
                  <rect
                    key={item.key}
                    className={styles[item.tone]}
                    x={x}
                    y={base}
                    width={barWidth}
                    height={height}
                  />
                );
              })}
              {labelled.has(index) && (
                <text className={styles.tick} x={x + barWidth / 2} y={HEIGHT - 8} textAnchor="middle">
                  {row.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </>
  );
}

/**
 * Horizontal bars for parts of a whole or a ranked list: a label, a bar and the number.
 *
 * @param {{ items: ReadonlyArray<{ label: string, value: number | string, text: string }>, tone?: string }} props
 */
export function RankBars({ items, tone = "primary" }) {
  const max = Math.max(1, ...items.map((item) => drawable(item.value)));
  if (items.length === 0) {
    return <p className={styles.note}>Nothing yet in this period.</p>;
  }
  return (
    <ul className={styles.ranks}>
      {items.map((item) => (
        <li key={item.label} className={styles.rank}>
          <span className={styles.rankLabel}>{item.label}</span>
          <svg className={styles.rankBar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
            <rect className={styles.track} x="0" y="0" width="100" height="10" />
            <rect
              className={styles[tone]}
              x="0"
              y="0"
              width={(drawable(item.value) / max) * 100}
              height="10"
            />
          </svg>
          <span className={styles.rankValue}>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Matches by weekday and hour, darker where more matches ended. Hidden cells (1 to 4 matches) are hatched.
 *
 * @param {{ summary: string, rows: ReadonlyArray<{ weekday: number, hours: ReadonlyArray<number | string> }> }} props
 */
export function Heatmap({ summary, rows }) {
  const cell = 22;
  const left = 40;
  const top = 18;
  const max = Math.max(1, ...rows.flatMap((row) => row.hours.map(drawable)));
  const level = (value) => {
    if (value === FEWER_THAN_MIN) return styles.hidden;
    return value === 0 ? styles.heat0 : styles[`heat${Math.max(1, Math.ceil((value / max) * 4))}`];
  };
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${left + 24 * cell} ${top + 7 * cell}`}
      role="img"
      aria-label={summary}
    >
      {[0, 6, 12, 18].map((hour) => (
        <text key={hour} className={styles.tick} x={left + hour * cell} y={12}>
          {String(hour).padStart(2, "0")}:00
        </text>
      ))}
      {rows.map((row, index) => (
        <g key={row.weekday}>
          <text className={styles.tick} x={left - 6} y={top + index * cell + 15} textAnchor="end">
            {WEEKDAYS[row.weekday - 1]}
          </text>
          {row.hours.map((value, hour) => (
            <rect
              key={hour}
              className={level(value)}
              x={left + hour * cell + 1}
              y={top + index * cell + 1}
              width={cell - 2}
              height={cell - 2}
              rx="3"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
