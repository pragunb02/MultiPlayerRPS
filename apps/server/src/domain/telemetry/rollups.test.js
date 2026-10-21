import { describe, expect, it } from "vitest";
import { TELEMETRY_EVENTS } from "@classicade/shared";
import { startOfDay } from "../../utils/indiaTime.js";
import {
  bucketPercentiles,
  groupKeyOf,
  mergeBuckets,
  OTHER_VALUE,
  percentilesOf,
  ROLLUP_ROW_BUDGET,
  ROLLUP_SPEC,
  rollUpDay,
  TOP_KEPT,
  worstCaseRows,
} from "./rollups.js";

const DAY = "2026-10-19";
const HOUR = 60 * 60 * 1000;
const at = (hour) => startOfDay(DAY) + hour * HOUR;

/** One hourly counter as the accessor lists it (CC-175): the tuple of catalogue fields, its hour and its count. */
const counter = (name, fields, count = 1, hour = 0) => ({
  name,
  build: "2026.10.19+abc1234",
  tier: "counts",
  route: "/",
  device: "phone",
  player_kind: "guest",
  ...fields,
  hour: at(hour),
  count,
});

const rowOf = (rows, event, group) =>
  rows.find((row) => row.event === event && groupKeyOf(row.group) === groupKeyOf(group));

describe("the rollup spec (CC-176)", () => {
  it("names only catalogue events and their fields", () => {
    for (const [event, spec] of Object.entries(ROLLUP_SPEC)) {
      expect(TELEMETRY_EVENTS[event], event).toBeDefined();
      const allowed = new Set([
        "build",
        "route",
        "device",
        "player_kind",
        ...Object.keys(TELEMETRY_EVENTS[event].fields),
      ]);
      spec.groups.flat().forEach((field) => expect(allowed.has(field), `${event}.${field}`).toBe(true));
      spec.timings.forEach((field) => expect(allowed.has(field), `${event}.${field}`).toBe(true));
    }
  });

  // AC-4
  it("the spec stays under the row budget", () => {
    const worst = worstCaseRows(ROLLUP_SPEC);

    expect(worst.total).toBeGreaterThan(0);
    expect(worst.total).toBeLessThanOrEqual(ROLLUP_ROW_BUDGET);
    expect(ROLLUP_ROW_BUDGET).toBe(20_000);
    // Every event of the catalogue is totalled at least by day.
    expect(Object.keys(worst.byEvent).sort()).toEqual(Object.keys(TELEMETRY_EVENTS).sort());
  });
});

describe("percentiles from the counters", () => {
  it("are exact from counters of a value and how often it came, by nearest rank", () => {
    // 100 values: 10 ms 50 times, 20 ms 25 times, 990 ms 20 times, 5000 ms 5 times.
    const values = new Map([
      [10, 50],
      [20, 25],
      [990, 20],
      [5000, 5],
    ]);

    expect(percentilesOf(values)).toEqual({ n: 100, p50: 10, p75: 20, p95: 990 });
    expect(percentilesOf(new Map([[300, 1]]))).toEqual({ n: 1, p50: 300, p75: 300, p95: 300 });
  });

  it("over a range come from the daily bucket counters, as the bucket's upper edge, never better than true", () => {
    const merged = mergeBuckets([
      [
        [100, 3],
        [2500, 2],
      ],
      [
        [100, 1],
        [4000, 4],
      ],
    ]);

    expect(merged).toEqual([
      [100, 4],
      [2500, 2],
      [4000, 4],
    ]);
    expect(bucketPercentiles(merged)).toEqual({ n: 10, p50: 2500, p75: 4000, p95: 4000 });
  });
});

describe("rollUpDay (CC-176)", () => {
  // AC-1
  it("totals each group exactly", () => {
    const counters = [
      counter("control_pressed", { route: "/", control: "home.play_guest", has_reason: false }, 4, 0),
      counter("control_pressed", { route: "/", control: "home.play_guest", has_reason: false }, 3, 5),
      counter("control_pressed", { route: "/login", control: "auth.submit", has_reason: true }, 2, 7),
      counter("dead_clicked", { route: "/", element: "img" }, 6, 2),
      counter("page_speed_measured", { lcp_ms: 1200, inp_ms: 80, cls: 0.02, was_waking: false }, 3, 1),
      counter("page_speed_measured", { lcp_ms: 3100, inp_ms: 240, cls: 0.3, was_waking: false }, 1, 1),
      counter(
        "page_speed_measured",
        { lcp_ms: 900, ttfb_ms: 300, was_waking: false, device: "desktop" },
        2,
        3,
      ),
    ];

    const rows = rollUpDay({ day: DAY, counters });

    expect(rowOf(rows, "control_pressed", {})).toEqual(
      expect.objectContaining({ day: DAY, count: 9, group: {} }),
    );
    expect(rowOf(rows, "control_pressed", { route: "/", control: "home.play_guest" }).count).toBe(7);
    expect(rowOf(rows, "control_pressed", { route: "/login", control: "auth.submit" }).count).toBe(2);
    expect(rowOf(rows, "control_pressed", { route: "/" }).count).toBe(7);
    expect(rowOf(rows, "dead_clicked", { route: "/", element: "img" }).count).toBe(6);

    const phone = rowOf(rows, "page_speed_measured", { route: "/", device: "phone" });
    expect(phone.count).toBe(4);
    // LCP 1200 three times and 3100 once: p50 and p75 are 1200, p95 is 3100.
    expect(phone.timings.lcp_ms).toEqual(expect.objectContaining({ n: 4, p50: 1200, p75: 1200, p95: 3100 }));
    expect(phone.timings.inp_ms).toEqual(expect.objectContaining({ n: 4, p50: 80, p75: 80, p95: 240 }));
    expect(phone.timings.cls).toEqual(expect.objectContaining({ n: 4, p50: 0.02, p75: 0.02, p95: 0.3 }));
    // A timing an event did not carry is not counted for it.
    expect(phone.timings.ttfb_ms).toBeUndefined();
    const all = rowOf(rows, "page_speed_measured", {});
    expect(all.timings.ttfb_ms).toEqual(expect.objectContaining({ n: 2, p50: 300 }));
    expect(all.timings.lcp_ms.n).toBe(6);
    // The daily row also keeps its bucket counters, so a range can be read without single values.
    expect(all.timings.lcp_ms.buckets).toEqual([
      [1000, 2],
      [1250, 3],
      [4000, 1],
    ]);
  });

  it("keeps only groups of the spec, never a field the spec does not list", () => {
    const rows = rollUpDay({
      day: DAY,
      counters: [counter("visit_ended", { active_s: "30-60", presses: "1-5" }, 5)],
    });

    rows.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(
        row.timings === undefined
          ? ["count", "day", "event", "group"]
          : ["count", "day", "event", "group", "timings"],
      );
      Object.keys(row.group).forEach((field) =>
        expect(ROLLUP_SPEC[row.event].groups.flat()).toContain(field),
      );
    });
    expect(rows.some((row) => "player_kind" in row.group && "presses" in row.group)).toBe(false);
  });

  it("keeps the busiest values of an open field and sums the rest as other, so forged names cannot grow the rows", () => {
    const counters = Array.from({ length: TOP_KEPT.control + 5 }, (_, index) =>
      counter("control_pressed", { control: `home.c${index}`, has_reason: false }, 100 - index),
    );

    const byControl = rollUpDay({ day: DAY, counters }).filter(
      (row) => row.event === "control_pressed" && Object.keys(row.group).sort().join() === "control,route",
    );

    expect(byControl).toHaveLength(TOP_KEPT.control + 1);
    const other = byControl.find((row) => row.group.control === OTHER_VALUE);
    // The five quietest: 100 - 25 ... 100 - 29.
    expect(other.count).toBe([75, 74, 73, 72, 71].reduce((a, b) => a + b, 0));
  });
});
