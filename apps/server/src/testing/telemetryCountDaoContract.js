import { expect, it } from "vitest";

/** The start of an India hour on 2026-10-20 (12:30 UTC is 18:00 in India). */
export const HOUR = Date.UTC(2026, 9, 20, 12, 30);
const H = 60 * 60 * 1000;

/** One counter row, as the accessor writes it: a tuple of catalogue fields, its India hour and how many. */
export const countRow = ({ name = "page_viewed", at = HOUR, count = 1, ...fields } = {}) => {
  const tuple = {
    name,
    route: "/",
    device: "phone",
    player_kind: "visitor",
    is_landing: true,
    ...fields,
    build: "0.1.0+abc1234",
    tier: "counts",
  };
  return { key: JSON.stringify(Object.entries(tuple).sort()), hour: new Date(at), fields: tuple, count };
};

/**
 * Behaviour every telemetry count DAO must have (CC-175, owner review 2026-10-21): the MongoDB DAO and the in-memory
 * double. Only counters are kept, one per tuple of catalogue fields and India hour, so no single event, no order and
 * no batch is stored.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/telemetryCountDao.js").createTelemetryCountDao>>} createDao
 */
export function runTelemetryCountDaoContract(createDao) {
  it("adds to one counter per tuple and hour, and lists counters by hour then tuple, never by arrival", async () => {
    const dao = await createDao();
    await dao.addCounts([countRow({ name: "visit_ended", at: HOUR + H }), countRow({ count: 2 })]);
    await dao.addCounts([countRow({ count: 3 }), countRow({ name: "control_pressed", at: HOUR })]);

    const listed = await dao.list({ from: new Date(HOUR), to: new Date(HOUR + 2 * H), limit: 10 });

    expect(listed.map(({ name, count, hour }) => [name, count, hour.getTime()])).toEqual([
      ["control_pressed", 1, HOUR],
      ["page_viewed", 5, HOUR],
      ["visit_ended", 1, HOUR + H],
    ]);
    expect(listed[1]).toEqual({ ...countRow().fields, hour: new Date(HOUR), count: 5 });
    expect(await dao.list({ from: new Date(HOUR), to: new Date(HOUR + H), limit: 1 })).toHaveLength(1);
  });

  it("adds nothing for an empty list", async () => {
    const dao = await createDao();
    await dao.addCounts([]);

    expect(await dao.countSince(new Date(0))).toBe(0);
  });

  it("counts the events from a moment on, as the sum of the counters", async () => {
    const dao = await createDao();
    await dao.addCounts([
      countRow({ at: HOUR - H, count: 4 }),
      countRow({ at: HOUR, count: 2 }),
      countRow({ name: "visit_ended", at: HOUR + H }),
    ]);

    expect(await dao.countSince(new Date(HOUR))).toBe(3);
    expect(await dao.countSince(new Date(HOUR + 2 * H))).toBe(0);
  });

  it("deletes the counters before a moment and says how many events they held", async () => {
    const dao = await createDao();
    await dao.addCounts([
      countRow({ at: HOUR - H, count: 2 }),
      countRow({ name: "visit_ended", at: HOUR - H }),
      countRow(),
    ]);

    expect(await dao.deleteBefore(new Date(HOUR))).toBe(3);
    expect(await dao.deleteBefore(new Date(HOUR))).toBe(0);
    expect(await dao.countSince(new Date(0))).toBe(1);
  });
}

/**
 * Counters back as one entry per event they hold, each `{ ...fields, receivedAt }` with the hour, for tests that read
 * what was stored. The order is the counters' order, never the order events came in.
 *
 * @param {ReadonlyArray<Record<string, unknown> & { hour: number, count: number }>} counters
 */
export const eventsOf = (counters) =>
  counters.flatMap(({ hour, count, ...fields }) =>
    Array.from({ length: count }, () => ({ ...fields, receivedAt: hour })),
  );
