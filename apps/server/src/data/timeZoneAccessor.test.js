import { describe, expect, it } from "vitest";
import { createInMemoryTimeZoneDao } from "../testing/inMemoryTimeZoneDao.js";
import { createTimeZoneAccessor } from "./timeZoneAccessor.js";

const record = Object.freeze({
  zone: "Asia/Dubai",
  previousZone: "Asia/Calcutta",
  changedAt: Date.parse("2026-10-21T10:00:00Z"),
  effectiveAt: Date.parse("2026-10-21T18:30:00Z"),
  floorDay: "2026-10-22",
});

describe("time zone accessor (CC-146)", () => {
  it("stores a record as dates and reads it back in milliseconds, frozen", async () => {
    const accessor = createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() });
    expect(await accessor.findFor("guest_a")).toEqual([]);
    expect(await accessor.save({ playerId: "guest_a", record, expected: undefined })).toBe(true);
    const [read] = await accessor.findFor("guest_a");
    expect(read).toEqual(record);
    expect(Object.isFrozen(read)).toBe(true);
  });

  it("refuses a write over a record it did not read", async () => {
    const accessor = createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() });
    await accessor.save({ playerId: "guest_a", record, expected: undefined });
    const next = { ...record, zone: "Europe/Paris", changedAt: record.changedAt + 1 };
    expect(await accessor.save({ playerId: "guest_a", record: next, expected: undefined })).toBe(false);
    expect(await accessor.save({ playerId: "guest_a", record: next, expected: record })).toBe(true);
    expect(await accessor.remove("guest_a")).toBe(1);
  });

  it("needs its DAO", () => {
    expect(() => createTimeZoneAccessor(/** @type {any} */ ({}))).toThrow();
  });
});
