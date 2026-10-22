import { describe, expect, it } from "vitest";
import { createTelemetryDailyAccessor } from "../../data/telemetryDailyAccessor.js";
import { createInMemoryTelemetryDailyDao } from "../../testing/inMemoryTelemetryDailyDao.js";
import { startOfDay } from "../../utils/indiaTime.js";
import {
  createTelemetryReport,
  FEWER_THAN_MIN,
  hideSmall,
  ratePer,
  shareOrHidden,
} from "./telemetryReport.js";

const row = (event, group, count, timings) => ({ event, group, count, ...(timings && { timings }) });

async function reportWith(days) {
  const daily = createTelemetryDailyAccessor({ telemetryDailyDao: createInMemoryTelemetryDailyDao() });
  for (const [day, rows] of Object.entries(days)) {
    await daily.replaceDay({ day, dayStart: startOfDay(day), rows });
  }
  return createTelemetryReport({ telemetryDailyAccessor: daily });
}

describe("the telemetry report (CC-176)", () => {
  // AC-6
  it("hides small totals", async () => {
    const report = await reportWith({
      "2026-10-19": [
        row("dead_clicked", { route: "/" }, 3),
        row("dead_clicked", { route: "/login" }, 0),
        row("dead_clicked", { route: "/profile" }, 2),
        row("page_speed_measured", { device: "phone" }, 4, {
          lcp_ms: {
            n: 4,
            p50: 900,
            p75: 1200,
            p95: 3100,
            buckets: [
              [1000, 2],
              [1250, 1],
              [4000, 1],
            ],
          },
        }),
      ],
      "2026-10-20": [row("dead_clicked", { route: "/profile" }, 4)],
    });

    const dead = await report.read({
      from: "2026-10-19",
      to: "2026-10-20",
      event: "dead_clicked",
      group: ["route"],
    });

    expect(dead).toEqual([
      { group: { route: "/" }, count: FEWER_THAN_MIN },
      { group: { route: "/login" }, count: 0 },
      // 2 and 4 on two days are 6 over the range: shown, because the range's total is what leaves.
      { group: { route: "/profile" }, count: 6 },
    ]);
    const [speed] = await report.read({
      from: "2026-10-19",
      to: "2026-10-19",
      event: "page_speed_measured",
      group: ["device"],
    });
    // A percentile of fewer than 5 values is hidden too (ADR-036.2).
    expect(speed).toEqual({
      group: { device: "phone" },
      count: FEWER_THAN_MIN,
      timings: {
        lcp_ms: { n: FEWER_THAN_MIN, p50: FEWER_THAN_MIN, p75: FEWER_THAN_MIN, p95: FEWER_THAN_MIN },
      },
    });
    expect(hideSmall(1)).toBe(FEWER_THAN_MIN);
    expect(hideSmall(4)).toBe(FEWER_THAN_MIN);
    expect(hideSmall(5)).toBe(5);
    // A share is shown only when its part and its whole are each 0 or at least 5.
    expect(shareOrHidden(3, 100)).toBe(FEWER_THAN_MIN);
    expect(shareOrHidden(5, 4)).toBe(FEWER_THAN_MIN);
    expect(shareOrHidden(0, 10)).toBe(0);
    expect(shareOrHidden(5, 20)).toBe(0.25);
    // A rate is checked on its part and whole first, and scaled after (review of #176, HIGH).
    expect(ratePer({ part: 3, whole: 200, per: 100 })).toBe(FEWER_THAN_MIN);
    expect(ratePer({ part: 5, whole: 4, per: 100 })).toBe(FEWER_THAN_MIN);
    expect(ratePer({ part: 0, whole: 0, per: 100 })).toBe(FEWER_THAN_MIN);
    expect(ratePer({ part: 0, whole: 200, per: 100 })).toBe(0);
    expect(ratePer({ part: 5, whole: 200, per: 100 })).toBe(2.5);
  });

  it("lists groups busiest first, and groups of the same size in a fixed order", async () => {
    const report = await reportWith({
      "2026-10-19": [
        row("dead_clicked", { route: "/b" }, 5),
        row("dead_clicked", { route: "/c" }, 9, {
          wait_ms: {
            n: 9,
            p50: 100,
            p75: 200,
            p95: 300,
            buckets: [
              [100, 5],
              [300, 4],
            ],
          },
        }),
        row("dead_clicked", { route: "/a" }, 5),
      ],
    });

    const rows = await report.totals({
      from: "2026-10-19",
      to: "2026-10-19",
      event: "dead_clicked",
      group: ["route"],
    });

    expect(rows.map(({ group }) => group.route)).toEqual(["/c", "/a", "/b"]);
    // Nine values are enough to show a percentile.
    const [shown] = await report
      .read({ from: "2026-10-19", to: "2026-10-19", event: "dead_clicked", group: ["route"] })
      .then((read) => read.filter(({ group }) => group.route === "/c"));
    expect(shown.timings.wait_ms).toEqual({ n: 9, p50: 100, p75: 300, p95: 300 });
  });

  it("reads a range's percentiles from the days' bucket counters, and a day's exactly", async () => {
    const timings = (p75, buckets) => ({ lcp_ms: { n: 10, p50: 900, p75, p95: 3000, buckets } });
    const report = await reportWith({
      "2026-10-19": [
        row(
          "page_speed_measured",
          {},
          10,
          timings(1100, [
            [1000, 6],
            [1250, 4],
          ]),
        ),
      ],
      "2026-10-20": [
        row(
          "page_speed_measured",
          {},
          10,
          timings(2600, [
            [1250, 2],
            [3000, 8],
          ]),
        ),
      ],
    });

    const [range] = await report.totals({
      from: "2026-10-19",
      to: "2026-10-20",
      event: "page_speed_measured",
      group: [],
    });
    const series = await report.series({
      from: "2026-10-19",
      to: "2026-10-20",
      event: "page_speed_measured",
      group: [],
    });

    expect(range.count).toBe(20);
    // 6 at most 1000, 6 more at most 1250, 8 at most 3000: the 15th of 20 is in the 3000 bucket.
    expect(range.timings.lcp_ms).toEqual({ n: 20, p50: 1250, p75: 3000, p95: 3000 });
    expect(series.map(({ day, timings: t }) => [day, t.lcp_ms.p75])).toEqual([
      ["2026-10-19", 1100],
      ["2026-10-20", 2600],
    ]);
  });
});
