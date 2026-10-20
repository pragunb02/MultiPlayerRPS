import { expect, it } from "vitest";

/** The start of an India hour on 2026-10-20 (12:30 UTC is 18:00 in India). */
export const HOUR = Date.UTC(2026, 9, 20, 12, 30);
const H = 60 * 60 * 1000;

/** One stored event, as the accessor writes it. */
export const storedEvent = ({ name = "page_viewed", at = HOUR, ...fields } = {}) => ({
  name,
  route: "/",
  device: "phone",
  player_kind: "visitor",
  is_landing: true,
  ...fields,
  build: "0.1.0+abc1234",
  tier: "counts",
  received_at: new Date(at),
});

/**
 * Behaviour every telemetry event DAO must have (CC-175): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/telemetryEventDao.js").createTelemetryEventDao>>} createDao
 */
export function runTelemetryEventDaoContract(createDao) {
  it("stores events and lists them in a range, oldest first, without an id", async () => {
    const dao = await createDao();
    await dao.insertMany([storedEvent({ at: HOUR + H }), storedEvent({ name: "visit_ended", at: HOUR })]);

    const listed = await dao.list({ from: new Date(HOUR), to: new Date(HOUR + 2 * H), limit: 10 });

    expect(listed.map(({ name }) => name)).toEqual(["visit_ended", "page_viewed"]);
    expect(listed[1]).toEqual(storedEvent({ at: HOUR + H }));
    expect(await dao.list({ from: new Date(HOUR), to: new Date(HOUR + H), limit: 10 })).toHaveLength(1);
    expect(await dao.list({ from: new Date(HOUR), to: new Date(HOUR + 2 * H), limit: 1 })).toHaveLength(1);
  });

  it("stores nothing for an empty batch", async () => {
    const dao = await createDao();
    await dao.insertMany([]);

    expect(await dao.countSince(new Date(0))).toBe(0);
  });

  it("counts the events from a moment on", async () => {
    const dao = await createDao();
    await dao.insertMany([
      storedEvent({ at: HOUR - H }),
      storedEvent({ at: HOUR }),
      storedEvent({ at: HOUR + H }),
    ]);

    expect(await dao.countSince(new Date(HOUR))).toBe(2);
    expect(await dao.countSince(new Date(HOUR + 2 * H))).toBe(0);
  });

  it("deletes the events before a moment and says how many", async () => {
    const dao = await createDao();
    await dao.insertMany([
      storedEvent({ at: HOUR - H }),
      storedEvent({ at: HOUR - H }),
      storedEvent({ at: HOUR }),
    ]);

    expect(await dao.deleteBefore(new Date(HOUR))).toBe(2);
    expect(await dao.deleteBefore(new Date(HOUR))).toBe(0);
    expect(await dao.countSince(new Date(0))).toBe(1);
  });
}
