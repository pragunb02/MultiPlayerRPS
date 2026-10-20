// Line charts of the load test results as SVG (CC-289), turned into PNG for the pull request's evidence. No chart
// library: a few lines, two axes and a dashed limit line are all the evidence needs.

const WIDTH = 960;
const HEIGHT = 540;
const PAD = Object.freeze({ left: 80, right: 200, top: 60, bottom: 70 });
// Distinct on white and safe for the common kinds of colour blindness (the Okabe and Ito palette).
const COLOURS = Object.freeze(["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"]);

const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );

/**
 * A round step for an axis that fits about five ticks up to `max`.
 *
 * @param {number} max
 * @returns {number}
 */
export function niceStep(max) {
  const raw = Math.max(max, 1e-9) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = [1, 2, 5, 10].find((candidate) => candidate * power >= raw);
  return factor * power;
}

/**
 * One chart with a line per series, points marked, and optional dashed limit lines.
 *
 * @param {{
 *   title: string,
 *   xLabel: string,
 *   yLabel: string,
 *   series: ReadonlyArray<{ name: string, points: ReadonlyArray<[number, number]> }>,
 *   limits?: ReadonlyArray<{ name: string, value: number }>,
 *   logX?: boolean,
 *   yMax?: number,
 * }} chart   points are `[x, y]`. With `logX` the x axis is logarithmic, for players from 2 to thousands, and every
 *   x must be at least 1. With `yMax` the y axis stops there and higher points are drawn on its top line, so a
 *   collapse does not flatten the interesting part of the chart
 * @returns {string} an SVG document
 */
export function lineChart({ title, xLabel, yLabel, series, limits = [], logX = false, yMax: cap }) {
  const xs = series.flatMap(({ points }) => points.map(([x]) => x));
  const ys = [
    ...series.flatMap(({ points }) => points.map(([, y]) => y)),
    ...limits.map(({ value }) => value),
  ];
  const xStep = niceStep(Math.max(1, ...xs));
  // A logarithmic axis ends at the next power of ten and marks 1, 2 and 5 of every decade.
  const decades = Math.ceil(Math.log10(Math.max(10, ...xs)));
  const yStep = niceStep(cap ?? Math.max(1, ...ys));
  const xMax = logX ? 10 ** decades : Math.ceil(Math.max(1, ...xs) / xStep) * xStep;
  const yMax = cap ?? Math.ceil(Math.max(1, ...ys) / yStep) * yStep;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const logMax = Math.log10(xMax);
  const px = logX ? (x) => PAD.left + (Math.log10(x) / logMax) * plotW : (x) => PAD.left + (x / xMax) * plotW;
  const py = (y) => PAD.top + plotH - (Math.min(y, yMax) / yMax) * plotH;
  const ticks = (step, max) => Array.from({ length: Math.round(max / step) + 1 }, (_, index) => index * step);
  const label = (value) => String(Math.round(value * 100) / 100);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Helvetica, Arial, sans-serif" font-size="14">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    `<text x="${PAD.left}" y="34" font-size="20" font-weight="bold" fill="#111">${escape(title)}</text>`,
    ...ticks(yStep, yMax).map(
      (y) =>
        `<line x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${py(y)}" y2="${py(y)}" stroke="#e5e5e5"/>` +
        `<text x="${PAD.left - 8}" y="${py(y) + 5}" text-anchor="end" fill="#444">${label(y)}</text>`,
    ),
    ...(logX
      ? Array.from({ length: decades }, (_, power) => [1, 2, 5].map((factor) => factor * 10 ** power))
          .flat()
          .concat(xMax)
      : ticks(xStep, xMax)
    ).map(
      (x) =>
        `<text x="${px(x)}" y="${PAD.top + plotH + 22}" text-anchor="middle" fill="#444">${label(x)}</text>`,
    ),
    `<line x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${py(0)}" y2="${py(0)}" stroke="#444"/>`,
    `<line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${py(0)}" stroke="#444"/>`,
    `<text x="${PAD.left + plotW / 2}" y="${HEIGHT - 20}" text-anchor="middle" fill="#111">${escape(xLabel)}</text>`,
    `<text transform="translate(22 ${PAD.top + plotH / 2}) rotate(-90)" text-anchor="middle" fill="#111">${escape(yLabel)}</text>`,
    ...limits.map(
      ({ name, value }) =>
        `<line x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${py(value)}" y2="${py(value)}" stroke="#B00020" stroke-dasharray="8 6" stroke-width="2"/>` +
        `<text x="${PAD.left + plotW - 4}" y="${py(value) - 6}" text-anchor="end" fill="#B00020">${escape(name)}</text>`,
    ),
    ...series.map(({ name, points }, index) => {
      const colour = COLOURS[index % COLOURS.length];
      const path = points.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
      const dots = points
        .map(([x, y]) => `<circle cx="${px(x)}" cy="${py(y)}" r="4" fill="${colour}"/>`)
        .join("");
      const legendY = PAD.top + 10 + index * 24;
      return (
        `<polyline points="${path}" fill="none" stroke="${colour}" stroke-width="2.5"/>${dots}` +
        `<rect x="${WIDTH - PAD.right + 20}" y="${legendY - 10}" width="14" height="14" fill="${colour}"/>` +
        `<text x="${WIDTH - PAD.right + 40}" y="${legendY + 2}" fill="#111">${escape(name)}</text>`
      );
    }),
    "</svg>",
  ];
  return parts.join("\n");
}
