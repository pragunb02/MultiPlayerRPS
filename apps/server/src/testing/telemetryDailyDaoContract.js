import { expect, it } from "vitest";

/** The start of the India day 2026-10-19 (18:30 UTC the evening before). */
export const DAY_AT = Date.UTC(2026, 9, 18, 18, 30);
const MINUTE = 60 * 1000;

/** One daily total as the accessor writes it. */
export const dailyRow = ({ event = "control_pressed", group = {}, count = 7, timings } = {}) => ({
  event,
  key: JSON.stringify(Object.entries(group).sort()),
  group,
  count,
  ...(timings && { timings }),
});

/**
 * Behaviour every telemetry daily DAO must have (CC-176): the MongoDB DAO and the in-memory double. A day's totals
 * are replaced as a whole, so running a day again gives the same rows, and each day has a run record with a lease,
 * so two processes never roll up the same day at once.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/telemetryDailyDao.js").createTelemetryDailyDao>>} createDao
 */
export function runTelemetryDailyDaoContract(createDao) {
  it("replaces a day's totals as a whole and reads them by day, event and group", async () => {
    const dao = await createDao();
    await dao.replaceDay({
      day: "2026-10-19",
      at: new Date(DAY_AT),
      rows: [dailyRow({ count: 3 }), dailyRow({ group: { route: "/" }, count: 2 })],
    });
    await dao.replaceDay({ day: "2026-10-20", at: new Date(DAY_AT + 24 * 60 * MINUTE), rows: [dailyRow()] });
    await dao.replaceDay({
      day: "2026-10-19",
      at: new Date(DAY_AT),
      rows: [dailyRow({ count: 4 }), dailyRow({ event: "visit_ended", count: 9 })],
    });

    const read = await dao.read({ from: "2026-10-19", to: "2026-10-20", events: ["control_pressed"] });

    expect(read).toEqual([
      { day: "2026-10-19", event: "control_pressed", group: {}, count: 4 },
      { day: "2026-10-20", event: "control_pressed", group: {}, count: 7 },
    ]);
    expect(await dao.read({ from: "2026-10-19", to: "2026-10-19", events: ["visit_ended"] })).toEqual([
      { day: "2026-10-19", event: "visit_ended", group: {}, count: 9 },
    ]);
  });

  it("keeps a row's timings as they were written", async () => {
    const dao = await createDao();
    const timings = {
      lcp_ms: {
        n: 6,
        p50: 1200,
        p75: 1200,
        p95: 3100,
        buckets: [
          [1250, 5],
          [4000, 1],
        ],
      },
    };
    await dao.replaceDay({
      day: "2026-10-19",
      at: new Date(DAY_AT),
      rows: [dailyRow({ event: "page_speed_measured", count: 6, timings })],
    });

    const [row] = await dao.read({ from: "2026-10-19", to: "2026-10-19", events: ["page_speed_measured"] });

    expect(row.timings).toEqual(timings);
  });

  it("leases a day to one owner at a time, and records when it was done", async () => {
    const dao = await createDao();
    const now = new Date(DAY_AT + 30 * 60 * MINUTE);
    const until = new Date(now.getTime() + 10 * MINUTE);
    const day = { day: "2026-10-19", at: new Date(DAY_AT) };

    expect(await dao.acquireRun({ ...day, owner: "a", now, until })).toBe(true);
    expect(await dao.acquireRun({ ...day, owner: "b", now, until })).toBe(false);
    expect(await dao.doneDays({ from: "2026-10-01", to: "2026-10-31" })).toEqual([]);

    await dao.finishRun({ day: "2026-10-19", owner: "a", now });

    expect(await dao.doneDays({ from: "2026-10-01", to: "2026-10-31" })).toEqual(["2026-10-19"]);
    // A finished day can be run again (the last 2 days always are), by anyone.
    expect(await dao.acquireRun({ ...day, owner: "b", now, until })).toBe(true);
    // A day still done while it is redone, so the console never sees it as missing.
    expect(await dao.doneDays({ from: "2026-10-19", to: "2026-10-19" })).toEqual(["2026-10-19"]);
  });

  it("lets another owner take a lease that ran out, or one given back after a failure", async () => {
    const dao = await createDao();
    const now = new Date(DAY_AT + 30 * 60 * MINUTE);
    const day = { day: "2026-10-19", at: new Date(DAY_AT) };
    await dao.acquireRun({ ...day, owner: "a", now, until: new Date(now.getTime() + MINUTE) });

    const later = new Date(now.getTime() + 2 * MINUTE);
    expect(
      await dao.acquireRun({ ...day, owner: "b", now: later, until: new Date(later.getTime() + MINUTE) }),
    ).toBe(true);
    await dao.releaseRun({ day: "2026-10-19", owner: "b", now: later });

    expect(
      await dao.acquireRun({ ...day, owner: "c", now: later, until: new Date(later.getTime() + MINUTE) }),
    ).toBe(true);
    // Giving back a lease someone else holds changes nothing.
    await dao.releaseRun({ day: "2026-10-19", owner: "a", now: later });
    expect(
      await dao.acquireRun({ ...day, owner: "d", now: later, until: new Date(later.getTime() + MINUTE) }),
    ).toBe(false);
  });
}
