import { describe, expect, it } from "vitest";

const AT = new Date(Date.UTC(2026, 9, 21, 10));
const LATER = new Date(Date.UTC(2026, 9, 28, 10));

const zoneDoc = (overrides = {}) => ({
  playerId: "guest_a",
  zone: "America/New_York",
  previousZone: "Asia/Calcutta",
  changedAt: AT,
  effectiveAt: new Date(Date.UTC(2026, 9, 21, 18, 30)),
  floorDay: "2026-10-22",
  ...overrides,
});

/**
 * Behaviour every time zone DAO must have (MongoDB DAO and the in-memory double), CC-146.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/timeZoneDao.js").createTimeZoneDao>>} createDao
 */
export function runTimeZoneDaoContract(createDao) {
  describe("time zone DAO contract", () => {
    it("finds nothing for a player without a zone", async () => {
      const dao = await createDao();
      expect(await dao.findByPlayer("guest_nobody")).toEqual([]);
    });

    it("creates a zone once and reads it back", async () => {
      const dao = await createDao();
      expect(await dao.save({ doc: zoneDoc(), expectedChangedAt: null })).toBe(true);
      expect(await dao.save({ doc: zoneDoc({ zone: "Europe/London" }), expectedChangedAt: null })).toBe(false);
      expect(await dao.findByPlayer("guest_a")).toEqual([zoneDoc()]);
    });

    it("replaces the zone only over the change it read", async () => {
      const dao = await createDao();
      await dao.save({ doc: zoneDoc(), expectedChangedAt: null });
      const next = zoneDoc({ zone: "Europe/London", previousZone: "America/New_York", changedAt: LATER });
      expect(await dao.save({ doc: next, expectedChangedAt: LATER })).toBe(false);
      expect(await dao.save({ doc: next, expectedChangedAt: AT })).toBe(true);
      expect(await dao.findByPlayer("guest_a")).toEqual([next]);
    });

    it("deletes a player's zone, and nothing the second time", async () => {
      const dao = await createDao();
      await dao.save({ doc: zoneDoc(), expectedChangedAt: null });
      await dao.save({ doc: zoneDoc({ playerId: "guest_b" }), expectedChangedAt: null });
      expect(await dao.deleteByPlayer("guest_a")).toBe(1);
      expect(await dao.deleteByPlayer("guest_a")).toBe(0);
      expect(await dao.findByPlayer("guest_b")).toHaveLength(1);
    });
  });
}
