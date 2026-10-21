import { IDENTITY_KINDS } from "@classicade/shared";
import { isAccountId } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { canonicalZone, changeZone, ZONE_CHANGE_LOCK_MS, zoneCalendar } from "./zoneCalendar.js";

/** Why a zone change was refused. */
export const TIME_ZONE_REFUSALS = Object.freeze({ LOCKED: "zone-locked" });
const MAX_ATTEMPTS = 3;

/**
 * Whose days are whose (CC-146, CC-145, ADR-077): each player's calendar, their time zone, and whether they get
 * local days and streak freezes. Streaks, quests and the daily puzzle ask it for a player's calendar and pass their
 * own `fallback` for when `local_days` is off, so each keeps the days it had before.
 *
 * @param {{
 *   timeZoneAccessor: ReturnType<typeof import("../../data/timeZoneAccessor.js").createTimeZoneAccessor>,
 *   flags: Pick<ReturnType<typeof import("../flags/flagComponent.js").createFlagComponent>, "isOn" | "recordSuccess">,
 * }} deps
 */
export function createPlayerDaysComponent({ timeZoneAccessor, flags }) {
  assertDefined(timeZoneAccessor, "timeZoneAccessor");
  assertFunction(flags?.isOn, "flags.isOn");
  assertFunction(flags?.recordSuccess, "flags.recordSuccess");

  /** The flag player for a stored id. Both flags are for everyone, so the console allowlist plays no part. */
  const flagPlayer = (playerId) => ({
    id: playerId,
    kind: isAccountId(playerId) ? IDENTITY_KINDS.USER : IDENTITY_KINDS.GUEST,
    admin: false,
  });

  const localDaysOn = (playerId) => flags.isOn("local_days", flagPlayer(playerId));

  const recordOf = async (playerId) => (await timeZoneAccessor.findFor(playerId))[0];

  async function requireLocalDays(playerId) {
    if (!(await localDaysOn(playerId))) {
      throw new NotFoundError("Not found");
    }
  }

  /** What the player sees of their zone. */
  function zoneView(record, now) {
    const calendar = zoneCalendar(record);
    return Object.freeze({
      zone: calendar.zone,
      chosen: record !== undefined,
      changeableAt: record === undefined ? null : Math.max(now, record.changedAt + ZONE_CHANGE_LOCK_MS),
      dayEndsAt: calendar.nextDayAt(now),
    });
  }

  return Object.freeze({
    /**
     * The player's calendar: their own days with `local_days` on (India time when their zone is unknown), the
     * caller's `fallback` with it off.
     *
     * @param {{ playerId: string, fallback: Readonly<import("./zoneCalendar.js").PlayerCalendar> }} query
     * @returns {Promise<Readonly<import("./zoneCalendar.js").PlayerCalendar>>}
     */
    async calendarFor({ playerId, fallback }) {
      return (await localDaysOn(playerId)) ? zoneCalendar(await recordOf(playerId)) : fallback;
    },

    /** @param {{ playerId: string }} query @returns {Promise<boolean>} whether `local_days` is on for the player */
    localDaysOn: ({ playerId }) => localDaysOn(playerId),

    /** @param {{ playerId: string }} query @returns {Promise<boolean>} whether `streak_freezes` is on */
    freezesOn: ({ playerId }) => flags.isOn("streak_freezes", flagPlayer(playerId)),

    /**
     * Counts the success of `streak_freezes`: a freeze covered a missed day and the player came back (ADR-073.6).
     *
     * @param {{ playerId: string }} input
     */
    freezeCovered: ({ playerId }) => flags.recordSuccess("streak_freezes", flagPlayer(playerId)),

    /**
     * The player's zone, whether they chose it, when it may change, and when their day ends.
     *
     * @param {{ playerId: string, now: number }} query
     * @throws {NotFoundError} with `local_days` off
     */
    async getTimeZone({ playerId, now }) {
      await requireLocalDays(playerId);
      return zoneView(await recordOf(playerId), now);
    },

    /**
     * Uses the zone the browser reported, at most once in 7 days (ADR-077.3). The zone in use again changes nothing.
     *
     * @param {{ playerId: string, zone: unknown, now: number }} input
     * @throws {NotFoundError} with `local_days` off
     * @throws {ValidationError} for a zone `Intl` does not know
     * @throws {ConflictError} `zone-locked` with `changeableAt` inside the 7 days
     */
    async setTimeZone({ playerId, zone, now }) {
      await requireLocalDays(playerId);
      const canonical = canonicalZone(zone);
      if (canonical === undefined) {
        throw new ValidationError("That is not a time zone");
      }
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const expected = await recordOf(playerId);
        const asked = changeZone({ record: expected, zone: canonical, now });
        if (asked.outcome === "locked") {
          throw new ConflictError("Your time zone changed less than 7 days ago", {
            details: { reason: TIME_ZONE_REFUSALS.LOCKED, changeableAt: asked.changeableAt },
          });
        }
        if (asked.outcome === "same") {
          return zoneView(asked.record, now);
        }
        if (await timeZoneAccessor.save({ playerId, record: asked.record, expected })) {
          await flags.recordSuccess("local_days", flagPlayer(playerId));
          return zoneView(asked.record, now);
        }
      }
      throw new ConflictError("The time zone kept changing");
    },

    /**
     * A guest became an account (ADR-014, ADR-077.9): the account keeps its own zone; one without takes the guest's,
     * with its lock. Idempotent.
     *
     * @param {{ from: string, to: { id: string } }} transfer
     * @returns {Promise<{ moved: { timeZone: number } }>}
     */
    async transferPlayer({ from, to }) {
      const guest = await recordOf(from);
      let moved = 0;
      if (guest !== undefined && (await recordOf(to.id)) === undefined) {
        moved = (await timeZoneAccessor.save({ playerId: to.id, record: guest, expected: undefined }))
          ? 1
          : 0;
      }
      await timeZoneAccessor.remove(from);
      return { moved: { timeZone: moved } };
    },

    /** @param {{ playerId: string }} query  the zone for the player's data export (ADR-048) */
    async exportPlayer({ playerId }) {
      const record = await recordOf(playerId);
      return record === undefined
        ? {}
        : {
            zone: record.zone,
            previousZone: record.previousZone,
            changedAt: new Date(record.changedAt).toISOString(),
          };
    },

    /** @param {{ playerId: string }} input @returns {Promise<{ erased: { timeZone: number } }>} */
    erasePlayer: async ({ playerId }) => ({ erased: { timeZone: await timeZoneAccessor.remove(playerId) } }),
  });
}
