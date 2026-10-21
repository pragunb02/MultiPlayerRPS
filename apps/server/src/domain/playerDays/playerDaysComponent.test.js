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
        expect(await refusal(days.getTimeZone({ playerId: "guest_a", now: NOW }))).toBeInstanceOf(
          NotFoundError,
        );
        expect(
          await refusal(days.setTimeZone({ playerId: "guest_a", zone: "Europe/London", now: NOW })),
        ).toBeInstanceOf(NotFoundError);
      }
    });
  });

  it("allows one change in 7 days", async () => {
    const { days, flags } = setUp();
    const set = await days.setTimeZone({ playerId: "guest_a", zone: "America/New_York", now: NOW });
    expect(set).toMatchObject({
      zone: "America/New_York",
      chosen: true,
      changeableAt: NOW + ZONE_CHANGE_LOCK_MS,
    });
    expect(flags.successes).toEqual([["local_days", "guest_a"]]);

    const locked = await refusal(
      days.setTimeZone({ playerId: "guest_a", zone: "Europe/London", now: NOW + ZONE_CHANGE_LOCK_MS - 1 }),
    );
    expect(locked).toBeInstanceOf(ConflictError);
    expect(locked.details).toEqual({
      reason: TIME_ZONE_REFUSALS.LOCKED,
      changeableAt: NOW + ZONE_CHANGE_LOCK_MS,
    });

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
    expect(await days.transferPlayer({ from: "guest_a", to: { id: "user_x" }, now: NOW })).toEqual({
      moved: { timeZone: 1 },
    });
    expect((await days.getTimeZone({ playerId: "user_x", now: NOW })).zone).toBe("Asia/Tokyo");
    expect((await days.getTimeZone({ playerId: "guest_a", now: NOW })).chosen).toBe(false);
    // The lock moved with it: a fresh guest cannot be used to reset it.
    expect(
      await refusal(days.setTimeZone({ playerId: "user_x", zone: "Europe/Paris", now: NOW + DAY })),
    ).toBeInstanceOf(ConflictError);

    await days.setTimeZone({ playerId: "guest_b", zone: "Europe/Paris", now: NOW });
    expect(await days.transferPlayer({ from: "guest_b", to: { id: "user_x" }, now: NOW })).toEqual({
      moved: { timeZone: 0 },
    });
    expect((await days.getTimeZone({ playerId: "user_x", now: NOW })).zone).toBe("Asia/Tokyo");
    // Again: nothing more.
    expect(await days.transferPlayer({ from: "guest_b", to: { id: "user_x" }, now: NOW })).toEqual({
      moved: { timeZone: 0 },
    });
  });

  it("moves nothing when the guest's zone is India's, or when the account got a zone at the same moment", async () => {
    const { days } = setUp();
    await days.setTimeZone({ playerId: "guest_a", zone: "America/New_York", now: NOW - ZONE_CHANGE_LOCK_MS });
    await days.setTimeZone({ playerId: "guest_a", zone: "Asia/Kolkata", now: NOW });
    expect(await days.transferPlayer({ from: "guest_a", to: { id: "user_x" }, now: NOW })).toEqual({
      moved: { timeZone: 0 },
    });
    expect((await days.getTimeZone({ playerId: "user_x", now: NOW })).chosen).toBe(false);

    const accessor = createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() });
    const racing = createPlayerDaysComponent({
      timeZoneAccessor: {
        ...accessor,
        save: async (write) => write.playerId !== "user_y" && accessor.save(write),
      },
      flags: fakeFlags(["local_days"]),
    });
    await racing.setTimeZone({ playerId: "guest_b", zone: "Asia/Tokyo", now: NOW });
    expect(await racing.transferPlayer({ from: "guest_b", to: { id: "user_y" }, now: NOW })).toEqual({
      moved: { timeZone: 0 },
    });
  });

  it("gives up with a conflict when every write of a change loses to another", async () => {
    const accessor = createTimeZoneAccessor({ timeZoneDao: createInMemoryTimeZoneDao() });
    const days = createPlayerDaysComponent({
      timeZoneAccessor: { ...accessor, save: async () => false },
      flags: fakeFlags(["local_days"]),
    });
    expect(
      await refusal(days.setTimeZone({ playerId: "guest_a", zone: "Asia/Tokyo", now: NOW })),
    ).toBeInstanceOf(ConflictError);
  });

  it("moves a guest's zone as a fresh change at the sign-in, never rewriting the account's past days", async () => {
    const { days } = setUp();
    // The guest chose New York days ago; the account has always had India days.
    await days.setTimeZone({ playerId: "guest_a", zone: "America/New_York", now: NOW - 3 * DAY });
    const signIn = NOW;
    await days.transferPlayer({ from: "guest_a", to: { id: "user_x" }, now: signIn });

    const calendar = await days.calendarFor({ playerId: "user_x", fallback: UTC_CALENDAR });
    // 01:00 on the 21st in India, still the 20th in New York: before the sign-in it stays an India day.
    expect(calendar.dayOf(Date.parse("2026-10-20T19:30:00Z"))).toBe("2026-10-21");
    // The account's India day still ends at India's midnight; New York days follow from then.
    expect(calendar.nextDayAt(signIn)).toBe(Date.parse("2026-10-21T18:30:00Z"));
    expect(calendar.dayOf(Date.parse("2026-10-21T18:30:00Z"))).toBe("2026-10-22");
    // The lock starts at the sign-in.
    expect((await days.getTimeZone({ playerId: "user_x", now: signIn })).changeableAt).toBe(
      signIn + ZONE_CHANGE_LOCK_MS,
    );
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
    const account = "user_0123456789abcdef01234567";
    expect(await days.freezesOn({ playerId: account })).toBe(true);
    expect(await days.localDaysOn({ playerId: account })).toBe(false);
    await days.freezeCovered({ playerId: account });
    expect(flags.successes).toEqual([["streak_freezes", account]]);
  });
});
