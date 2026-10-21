import { describe, expect, it } from "vitest";
import { checkTelemetryEvent, TELEMETRY_EVENTS } from "@classicade/shared";
import { captureLogger } from "../../testing/captureLogger.js";
import { uxReportOver } from "../../testing/uxFixture.js";
import { uxSeedEvents } from "../../testing/uxSeed.js";
import { startOfDay } from "../../utils/indiaTime.js";
import { defaultRange, lastFullWeekOf, rangeBefore, UX_REPORT_TTL_MS } from "./uxReport.js";

// 09:00 in India on Wednesday 2026-10-21.
const NOW = startOfDay("2026-10-21") + 9 * 60 * 60 * 1000;
const RANGE = { from: "2026-10-14", to: "2026-10-20" };

describe("the UX report's ranges (CC-177)", () => {
  it("opens on the last 7 full India days against the 7 before, never a partial today", () => {
    expect(defaultRange(NOW)).toEqual(RANGE);
    expect(rangeBefore(RANGE)).toEqual({ from: "2026-10-07", to: "2026-10-13" });
  });

  it("reads the week as the last full Monday to Sunday India week", () => {
    expect(lastFullWeekOf(NOW)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    // On a Monday the week just ended is the one shown.
    expect(lastFullWeekOf(startOfDay("2026-10-19") + 60_000)).toEqual({
      from: "2026-10-12",
      to: "2026-10-18",
    });
  });

  it("is made of catalogue events only", () => {
    uxSeedEvents({ day: "2026-10-20" }).forEach(({ receivedAt, build, tier, ...event }) => {
      const by = TELEMETRY_EVENTS[event.name].by;
      expect(checkTelemetryEvent(event, by), event.name).toEqual(expect.objectContaining({ ok: true }));
    });
  });
});

describe("the UX report (CC-177)", () => {
  // AC-6
  it("caches per range for 5 minutes", async () => {
    const log = captureLogger();
    const { uxReport, reads, clock } = await uxReportOver({ now: NOW });

    const first = await uxReport.get({ section: "clicks", range: RANGE });
    const asked = reads.length;
    const second = await uxReport.get({ section: "clicks", range: RANGE });

    expect(asked).toBeGreaterThan(0);
    expect(reads).toHaveLength(asked);
    expect(second).toBe(first);
    // Another range is its own entry.
    await uxReport.get({ section: "clicks", range: { from: "2026-10-20", to: "2026-10-20" } });
    expect(reads.length).toBeGreaterThan(asked);
    // After 5 minutes it is worked out again.
    const counted = reads.length;
    clock.now += UX_REPORT_TTL_MS + 1;
    await uxReport.get({ section: "clicks", range: RANGE });
    expect(reads.length).toBeGreaterThan(counted);
    // It is never told who asked, so it cannot log it: nothing was written at all.
    expect(uxReport.get.length).toBe(1);
    expect(log.entries).toEqual([]);
  });

  it("gives funnels as totals with ratios capped at 100 %", async () => {
    const { uxReport } = await uxReportOver({ now: NOW });

    const { funnels, byEntry, rejected, registered } = await uxReport.get({
      section: "funnels",
      range: RANGE,
    });

    const [visit, link, signUp] = funnels;
    expect(visit.steps.map(({ id, now }) => [id, now])).toEqual([
      ["landed", 193 * 7],
      ["first_move", 137 * 7],
    ]);
    expect(visit.steps[1].ratio).toBeCloseTo(137 / 193, 3);
    expect(link.steps.map(({ now }) => now)).toEqual([40 * 7, 32 * 7, 28 * 7]);
    expect(signUp.steps.map(({ now }) => now)).toEqual([350, 140, 84]);
    expect(byEntry.find(({ entry }) => entry === "search")).toEqual(
      expect.objectContaining({ landings: 21, firstMoves: 14 }),
    );
    expect(rejected).toContainEqual({ field: "email", rule: "format", count: 21 });
    const challenge = registered.find(({ id }) => id === "challenge");
    expect(challenge.steps[1]).toEqual(expect.objectContaining({ now: 21, ratio: 0.5 }));
  });

  it("hides every count from 1 to 4 and every share made of one", async () => {
    const { uxReport } = await uxReportOver({ now: NOW });
    // One day: the seed's small groups (3 searches, 2 dead clicks, 3 slow-page timings) stay small.
    const day = { from: "2026-10-20", to: "2026-10-20" };

    const clicks = await uxReport.get({ section: "clicks", range: day });
    const speed = await uxReport.get({ section: "speed", range: day });
    const funnels = await uxReport.get({ section: "funnels", range: day });

    const leaderboard = clicks.deadHotspots.find(({ route }) => route === "/leaderboards");
    expect(leaderboard).toEqual(expect.objectContaining({ count: "<5", share: "<5" }));
    const slow = speed.byRouteDevice.find(({ route }) => route === "/leaderboards");
    expect(slow).toEqual(expect.objectContaining({ pages: "<5" }));
    expect(slow.p75.lcp_ms).toBe("<5");
    const search = funnels.byEntry.find(({ entry }) => entry === "search");
    expect(search).toEqual(expect.objectContaining({ landings: "<5", firstMoves: "<5", ratio: "<5" }));
    for (const section of [clicks, speed, funnels]) {
      expect(smallNumbers(section)).toEqual([]);
    }
  });

  it("lists the top hotspots with their share of the route's presses", async () => {
    const { uxReport } = await uxReportOver({ now: NOW });

    const { deadHotspots, rageHotspots } = await uxReport.get({ section: "clicks", range: RANGE });

    expect(deadHotspots[0]).toEqual({ route: "/", target: "img", by: "element", count: 98, share: 0.07 });
    expect(rageHotspots[0]).toEqual(
      expect.objectContaining({
        route: "/games/rock-paper-scissors/rooms/:code",
        target: "room.rematch.ask",
      }),
    );
  });

  it("colours the interruption budget and gives the worst colour for the badge", async () => {
    const { uxReport } = await uxReportOver({ now: NOW });

    const { lines, surfaces, worst } = await uxReport.get({ section: "interruptions", range: RANGE });
    const { badge } = await uxReport.get({ section: "badge", range: RANGE });

    const line = (measure) => lines.find((each) => each.measure === measure);
    // 139 optional system interruptions over 150 visits a day: amber.
    expect(line("optional_per_visit")).toEqual(expect.objectContaining({ colour: "amber" }));
    // 29 dead and rage clicks over 292 presses a day: red.
    expect(line("rage_and_dead_per_100_presses")).toEqual(expect.objectContaining({ colour: "red" }));
    expect(line("blocking_optional_during_play")).toEqual(
      expect.objectContaining({ value: 0, colour: "green" }),
    );
    expect(surfaces.find(({ surface }) => surface === "toast.xp").dismissed.colour).toBe("green");
    expect(worst).toBe("red");
    expect(badge).toBe("red");
  });

  it("the weekly report shows each section", async () => {
    const { uxReport } = await uxReportOver({ now: NOW });

    const week = await uxReport.get({ section: "week", range: lastFullWeekOf(NOW) });

    expect(Object.keys(week)).toEqual(
      expect.arrayContaining([
        "budget",
        "surfaces",
        "perVisitAndGame",
        "text",
        "firstMove",
        "hotspots",
        "funnels",
        "flagGuardrails",
        "badge",
      ]),
    );
    expect(week.surfaces[0]).toEqual(
      expect.objectContaining({ surface: "toast.xp", ticket: "CC-017", medianShown: "3-10s" }),
    );
    expect(week.text.budgets.home).toBe(80);
    expect(smallNumbers(week)).toEqual([]);
  });

  // Review of #176, HIGH (ADR-036): a rate per 100 must not let a hidden count of 1 to 4 be worked out.
  it("hides every rate per 100 whose part is 1 to 4, and gives a hidden value no colour", async () => {
    const BUILD = "2026.10.20+def5678";
    const many = (day, count, name, fields) =>
      Array.from({ length: count }, (_, index) => ({
        receivedAt: startOfDay(day) + (index % 24) * 60 * 60 * 1000,
        name,
        build: BUILD,
        tier: "counts",
        route: "/",
        device: "phone",
        player_kind: "guest",
        ...fields,
      }));
    const ended = (outcome) => ({
      surface: "toast.xp",
      kind: "toast",
      class: "optional",
      blocking: false,
      outcome,
      shown_ms: "1-3s",
      phase: "result",
      trigger: "system",
      stack: "0",
    });
    const { uxReport } = await uxReportOver({
      now: NOW,
      seed: false,
      extra: (day) => [
        ...many(day, 200, "control_pressed", { control: "home.play_guest", has_reason: false }),
        ...many(day, 3, "dead_clicked", { element: "img" }),
        ...many(day, 100, "page_viewed", { is_landing: false }),
        ...many(day, 3, "client_errored", { kind: "render", error_type: "TypeError" }),
        ...many(day, 100, "visit_ended", { active_s: "30-60", presses: "6-20" }),
        ...many(day, 60, "interruption_ended", ended("timed_out")),
        ...many(day, 3, "interruption_ended", ended("dismissed")),
      ],
    });
    const day = { from: "2026-10-20", to: "2026-10-20" };

    const clicks = await uxReport.get({ section: "clicks", range: day });
    const errors = await uxReport.get({ section: "errors", range: day });
    const budget = await uxReport.get({ section: "interruptions", range: day });

    // 3 dead clicks in 200 presses would read as 1.5 per 100, and 1.5 × 2 gives the 3 back.
    expect(clicks.per100Presses.now).toBe("<5");
    const browser = errors.events.find(({ event }) => event === "client_errored");
    expect(browser.byBuild).toEqual([{ build: BUILD, count: "<5", per100Pages: "<5" }]);
    const rate = budget.lines.find(({ measure }) => measure === "rage_and_dead_per_100_presses");
    expect(rate).toEqual(expect.objectContaining({ value: "<5", colour: "none" }));
    // 3 dismissed of 63 shown: hidden, and no colour to narrow it down.
    const xp = budget.surfaces.find(({ surface }) => surface === "toast.xp");
    expect(xp.dismissed).toEqual({ value: "<5", colour: "none" });
    expect(budget.worst).toBe("amber");
  });

  it("answers an empty store with zeros and hidden shares, never an error", async () => {
    const { uxReport } = await uxReportOver({ now: NOW, seed: false });

    const funnels = await uxReport.get({ section: "funnels", range: RANGE });

    expect(funnels.funnels[0].steps[1]).toEqual(expect.objectContaining({ now: 0, ratio: "<5" }));
  });
});

/** Every count field holding 1 to 4: none may leave the server (ADR-036.2). */
function smallNumbers(value, path = "") {
  const COUNT_KEYS = /^(count|now|before|shown|pages|games|presses|landings|firstMoves|n)$/;
  if (Array.isArray(value)) return value.flatMap((item, index) => smallNumbers(item, `${path}[${index}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (
      COUNT_KEYS.test(key) &&
      typeof child === "number" &&
      Number.isInteger(child) &&
      child > 0 &&
      child < 5
    )
      return [`${path}.${key}`];
    return smallNumbers(child, `${path}.${key}`);
  });
}
