import { describe, expect, it } from "vitest";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { createTelemetryAccessor } from "../../data/telemetryAccessor.js";
import { createInMemoryTelemetryEventDao } from "../../testing/inMemoryTelemetryEventDao.js";
import { ValidationError } from "../../utils/errors.js";
import { createTelemetryComponent, indiaHourOf } from "./telemetryComponent.js";

// 22:00 in India on 2026-10-20 is 16:30 UTC. That India day started at 18:30 UTC on 2026-10-19.
const EVENING = Date.UTC(2026, 9, 20, 16, 45);
const DAY_START = Date.UTC(2026, 9, 19, 18, 30);
const H = 60 * 60 * 1000;

function setup({ storedPerDay = 5, clock = { at: EVENING } } = {}) {
  const dao = createInMemoryTelemetryEventDao();
  const accessor = createTelemetryAccessor({ telemetryEventDao: dao });
  const drops = [];
  const component = createTelemetryComponent({
    telemetryAccessor: accessor,
    now: () => clock.at,
    limits: { storedPerDay },
    onDropped: (drop) => drops.push(drop),
    serverBuild: "2026.10.20+a40ce5b",
  });
  const stored = () => accessor.list({ from: 0, to: Date.UTC(2030, 0), limit: 1000 });
  return { dao, accessor, component, drops, clock, stored };
}

const batch = (count) => ({
  build: "0.1.0+abc1234",
  events: Array.from({ length: count }, () => exampleTelemetryEvent("control_pressed")),
});

describe("telemetry component (CC-175)", () => {
  // AC-6 (CC-175)
  it("stops storing at the daily cap", async () => {
    const { component, drops, stored, clock } = setup({ storedPerDay: 5 });

    expect(await component.storeBatch(batch(3))).toBe(3);
    expect(await component.storeBatch(batch(4))).toBe(2);
    expect(await component.storeBatch(batch(1))).toBe(0);

    expect(await stored()).toHaveLength(5);
    expect(drops).toEqual([
      { reason: "cap", count: 2 },
      { reason: "cap", count: 1 },
    ]);

    // The next India day starts at 18:30 UTC, with room again.
    clock.at = Date.UTC(2026, 9, 20, 18, 31);
    expect(await component.storeBatch(batch(2))).toBe(2);
  });

  it("counts what the database already holds for the day after a restart", async () => {
    const first = setup({ storedPerDay: 4 });
    await first.component.storeBatch(batch(3));
    // An event from before the day started does not count against it.
    await first.accessor.add([{ ...exampleTelemetryEvent("page_viewed"), receivedAt: DAY_START - H }]);

    const restarted = createTelemetryComponent({
      telemetryAccessor: first.accessor,
      now: () => EVENING,
      limits: { storedPerDay: 4 },
      serverBuild: "unknown",
    });

    expect(await restarted.storeBatch(batch(3))).toBe(1);
  });

  it("two batches at once never store more than the cap together", async () => {
    const { component, stored } = setup({ storedPerDay: 5 });

    const results = await Promise.all([component.storeBatch(batch(4)), component.storeBatch(batch(4))]);

    expect(results.reduce((a, b) => a + b)).toBe(5);
    expect(await stored()).toHaveLength(5);
  });

  it("stores each event with its build, the counts tier and the India hour it arrived in", async () => {
    const { component, stored } = setup();

    await component.storeBatch({ build: "0.1.0+abc1234", events: [exampleTelemetryEvent("page_viewed")] });

    expect(await stored()).toEqual([
      {
        ...exampleTelemetryEvent("page_viewed"),
        build: "0.1.0+abc1234",
        tier: "counts",
        receivedAt: indiaHourOf(EVENING),
      },
    ]);
    // 22:15 in India is kept as 22:00 in India, 16:30 UTC.
    expect(indiaHourOf(EVENING)).toBe(Date.UTC(2026, 9, 20, 16, 30));
    expect(indiaHourOf(Date.UTC(2026, 9, 20, 16, 29, 59))).toBe(Date.UTC(2026, 9, 20, 15, 30));
  });

  it("records a server event through the same catalogue, with the server's build", async () => {
    const { component, stored } = setup();

    expect(await component.record({ name: "guest_started", player_kind: "guest" })).toBe(1);
    await expect(
      component.record({ name: "guest_started", player_kind: "guest", ip: "10.0.0.1" }),
    ).rejects.toThrow(ValidationError);
    await expect(component.record(exampleTelemetryEvent("page_viewed"))).rejects.toThrow(ValidationError);

    expect(await stored()).toEqual([
      {
        name: "guest_started",
        player_kind: "guest",
        build: "2026.10.20+a40ce5b",
        tier: "counts",
        receivedAt: indiaHourOf(EVENING),
      },
    ]);
  });

  it("purges the events before a day, and the cap counts again after a purge of today", async () => {
    const { component, accessor, stored } = setup({ storedPerDay: 3 });
    await accessor.add([{ ...exampleTelemetryEvent("page_viewed"), receivedAt: DAY_START - 2 * H }]);
    await component.storeBatch(batch(3));

    expect(await component.purgeBefore("2026-10-20")).toBe(1);
    expect(await stored()).toHaveLength(3);
    expect(await component.purgeBefore("2026-10-21")).toBe(3);
    expect(await component.storeBatch(batch(3))).toBe(3);
  });

  it("does not count a drop of nothing, and puts the count back when a write fails", async () => {
    const dao = createInMemoryTelemetryEventDao();
    let failing = true;
    const flaky = {
      ...dao,
      insertMany: async (docs) => {
        if (failing) throw new Error("database down");
        return dao.insertMany(docs);
      },
    };
    const drops = [];
    const component = createTelemetryComponent({
      telemetryAccessor: createTelemetryAccessor({ telemetryEventDao: flaky }),
      now: () => EVENING,
      limits: { storedPerDay: 2 },
      onDropped: (drop) => drops.push(drop),
      serverBuild: "unknown",
    });
    expect(await component.storeBatch(batch(0))).toBe(0);
    component.dropped("invalid", 0);
    expect(drops).toEqual([]);

    await expect(component.storeBatch(batch(2))).rejects.toThrow("database down");
    failing = false;
    expect(await component.storeBatch(batch(2))).toBe(2);
  });
});
