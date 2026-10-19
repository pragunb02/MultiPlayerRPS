import { describe, expect, it } from "vitest";

import { lineChart, niceStep } from "./chart.mjs";

describe("niceStep", () => {
  it.each([
    [10, 2],
    [100, 20],
    [150, 50],
    [7, 2],
    [0.4, 0.1],
    [0, 2e-10],
  ])("steps an axis up to %s by %s", (max, step) => {
    expect(niceStep(max)).toBeCloseTo(step, 12);
  });
});

describe("lineChart", () => {
  const chart = lineChart({
    title: "Move p95 <by players>",
    xLabel: "players at once",
    yLabel: "ms",
    series: [
      {
        name: "free",
        points: [
          [10, 20],
          [20, 60],
        ],
      },
      { name: "starter & more", points: [[10, 10]] },
    ],
    limits: [{ name: "NFR-3 150 ms", value: 150 }],
  });

  it("draws a line and a legend entry per series, and the limit as a dashed line", () => {
    expect(chart.startsWith("<svg")).toBe(true);
    expect(chart.match(/<polyline /g)).toHaveLength(2);
    expect(chart).toContain("stroke-dasharray");
    expect(chart).toContain("NFR-3 150 ms");
  });

  it("escapes text", () => {
    expect(chart).toContain("Move p95 &lt;by players&gt;");
    expect(chart).toContain("starter &amp; more");
  });

  it("scales the y axis to the limit when it is higher than every point", () => {
    expect(chart).toContain(">150</text>");
  });

  it("marks 1, 2 and 5 of every decade on a logarithmic x axis, up to the next power of ten", () => {
    const log = lineChart({
      title: "t",
      xLabel: "x",
      yLabel: "y",
      series: [
        {
          name: "a",
          points: [
            [2, 1],
            [300, 2],
          ],
        },
      ],
      logX: true,
    });
    const labels = [...log.matchAll(/text-anchor="middle" fill="#444">(\d+)</g)].map((match) =>
      Number(match[1]),
    );

    expect(labels).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]);
    expect(log).toContain('<text x="80" y="492" text-anchor="middle" fill="#444">1</text>');
  });

  it("draws an empty chart without failing", () => {
    expect(lineChart({ title: "t", xLabel: "x", yLabel: "y", series: [] })).toContain("</svg>");
  });
});
