import { describe, expect, it } from "vitest";
import { createTimeZoneAccessor } from "../../data/timeZoneAccessor.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { createInMemoryTimeZoneDao } from "../../testing/inMemoryTimeZoneDao.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { createPlayerDaysComponent, TIME_ZONE_REFUSALS } from "./playerDaysComponent.js";
import { DEFAULT_ZONE, UTC_CALENDAR, ZONE_CHANGE_LOCK_MS } from "./zoneCalendar.js";

// The player days component (CC-146). Every moment is written out: nothing reads the real clock (CC-325).
const NOW = Date.parse("2026-10-21T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** A fake flag component: the names in `on` are on for everyone; successes are remembered. */
function fakeFlags(on) {
  const successes = [];
  return {
    successes,
    isOn: async (name) => on.includes(name),
    recordSuccess: async (name, player) => successes.push([name, player.id]),
  };
}

function setUp(on = ["local_days"]) {
  const flags = fakeFlags(on);
  const days = createPlayerDaysComponent({
    timeZoneAccessor: createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() }),
    flags,
  });
  return { days, flags };
}

const refusal = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
};

describe("player days (CC-146)", () => {
  flagPaths("local_days", (on) => {
    it(on ? "gives the player's own calendar" : "gives the caller's own calendar back", async () => {
      const { days } = setUp(on ? ["local_days"] : []);
      const calendar = await days.calendarFor({ playerId: "guest_a", fallback: UTC_CALENDAR });
      expect(calendar.zone).toBe(on ? DEFAULT_ZONE : "UTC");
    });

    it(on ? "answers the zone" : "answers 404 for the zone", async () => {
      const { days } = setUp(on ? ["local_days"] : []);
      if (on) {
        expect(await days.getTimeZone({ playerId: "guest_a", now: NOW })).toEqual({
          zone: DEFAULT_ZONE,
          chosen: false,
          changeableAt: null,
          dayEndsAt: Date.parse("2026-10-21T18:30:00Z"),
        });
      } else {
        expect(await refusal(days.getTimeZone({ playerId: "guest_a", now: NOW }))).toBeInstanceOf(NotFoundError);
        expect(
          await refusal(days.setTimeZone({ playerId: "guest_a", zone: "Europe/London", now: NOW })),
        ).toBeInstanceOf(NotFoundError);
      }
    });
  });

  it("allows one change in 7 days", async () => {
    const { days, flags } = setUp();
    const set = await days.setTimeZone({ playerId: "guest_a", zone: "America/New_York", now: NOW });
    expect(set).toMatchObject({ zone: "America/New_York", chosen: true, changeableAt: NOW + ZONE_CHANGE_LOCK_MS });
    expect(flags.successes).toEqual([["local_days", "guest_a"]]);

    const locked = await refusal(
      days.setTimeZone({ playerId: "guest_a", zone: "Europe/London", now: NOW + ZONE_CHANGE_LOCK_MS - 1 }),
    );
    expect(locked).toBeInstanceOf(ConflictError);
    expect(locked.details).toEqual({ reason: TIME_ZONE_REFUSALS.LOCKED, changeableAt: NOW + ZONE_CHANGE_LOCK_MS });

    // The zone already in use again: nothing changes, no lock is started.
    const same = await days.setTimeZone({ playerId: "guest_a", zone: "America/New_York", now: NOW + DAY });
    expect(same.changeableAt).toBe(NOW + ZONE_CHANGE_LOCK_MS);

    const later = await days.setTimeZone({
      playerId: "guest_a",
      zone: "Europe/London",
      now: NOW + ZONE_CHANGE_LOCK_MS,
    });
    expect(later).toMatchObject({ zone: "Europe/London", changeableAt: NOW + 2 * ZONE_CHANGE_LOCK_MS });
  });

  it("starts no lock when the browser's zone is India and none is stored", async () => {
    const { days } = setUp();
    expect(await days.setTimeZone({ playerId: "guest_a", zone: "Asia/Kolkata", now: NOW })).toMatchObject({
      chosen: false,
      changeableAt: null,
    });
  });

  it("refuses a zone that is not a real time zone", async () => {
    const { days } = setUp();
    for (const zone of ["Mars/Base", "", 42, null, "x".repeat(65)]) {
      expect(await refusal(days.setTimeZone({ playerId: "guest_a", zone, now: NOW }))).toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("moves a guest's zone only when the account has none", async () => {
    const { days } = setUp();
    await days.setTimeZone({ playerId: "guest_a", zone: "Asia/Tokyo", now: NOW });
    expect(await days.transferPlayer({ from: "guest_a", to: { id: "user_x" } })).toEqual({ moved: { timeZone: 1 } });
    expect((await days.getTimeZone({ playerId: "user_x", now: NOW })).zone).toBe("Asia/Tokyo");
    expect((await days.getTimeZone({ playerId: "guest_a", now: NOW })).chosen).toBe(false);
    // The lock moved with it: a fresh guest cannot be used to reset it.
    expect(
      await refusal(days.setTimeZone({ playerId: "user_x", zone: "Europe/Paris", now: NOW + DAY })),
    ).toBeInstanceOf(ConflictError);

    await days.setTimeZone({ playerId: "guest_b", zone: "Europe/Paris", now: NOW });
    expect(await days.transferPlayer({ from: "guest_b", to: { id: "user_x" } })).toEqual({ moved: { timeZone: 0 } });
    expect((await days.getTimeZone({ playerId: "user_x", now: NOW })).zone).toBe("Asia/Tokyo");
    // Again: nothing more.
    expect(await days.transferPlayer({ from: "guest_b", to: { id: "user_x" } })).toEqual({ moved: { timeZone: 0 } });
  });

  it("exports and erases the zone", async () => {
    const { days } = setUp();
    expect(await days.exportPlayer({ playerId: "user_x" })).toEqual({});
    await days.setTimeZone({ playerId: "user_x", zone: "Asia/Dubai", now: NOW });
    expect(await days.exportPlayer({ playerId: "user_x" })).toEqual({
      zone: "Asia/Dubai",
      previousZone: DEFAULT_ZONE,
      changedAt: "2026-10-21T10:00:00.000Z",
    });
    expect(await days.erasePlayer({ playerId: "user_x" })).toEqual({ erased: { timeZone: 1 } });
    expect(await days.erasePlayer({ playerId: "user_x" })).toEqual({ erased: { timeZone: 0 } });
  });

  it("asks the streak_freezes flag for freezes and counts its success", async () => {
    const { days, flags } = setUp(["streak_freezes"]);
    expect(await days.freezesOn({ playerId: "user_x" })).toBe(true);
    expect(await days.localDaysOn({ playerId: "user_x" })).toBe(false);
    await days.freezeCovered({ playerId: "user_x" });
    expect(flags.successes).toEqual([["streak_freezes", "user_x"]]);
  });
});
