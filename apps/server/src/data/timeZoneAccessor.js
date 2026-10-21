import { assertDefined } from "../utils/assert.js";

/**
 * Players' time zones for the domain (CC-146, ADR-077): moments as milliseconds, frozen records, no storage types.
 *
 * @param {{ timeZoneDao: ReturnType<typeof import("../persistence/timeZoneDao.js").createTimeZoneDao> }} deps
 */
export function createTimeZoneAccessor({ timeZoneDao }) {
  assertDefined(timeZoneDao, "timeZoneDao");

  const toRecord = ({ zone, previousZone, changedAt, effectiveAt, floorDay }) =>
    Object.freeze({
      zone,
      previousZone,
      changedAt: changedAt.getTime(),
      effectiveAt: effectiveAt.getTime(),
      floorDay,
    });

  return Object.freeze({
    /**
     * @param {string} playerId
     * @returns {Promise<ReadonlyArray<Readonly<import("../domain/playerDays/zoneCalendar.js").ZoneRecord>>>} none or one
     */
    findFor: async (playerId) => Object.freeze((await timeZoneDao.findByPlayer(playerId)).map(toRecord)),

    /**
     * Stores a player's zone over the one read (`expected`, or `undefined` when there was none).
     *
     * @param {{ playerId: string, record: Readonly<import("../domain/playerDays/zoneCalendar.js").ZoneRecord>,
     *   expected: Readonly<import("../domain/playerDays/zoneCalendar.js").ZoneRecord> | undefined }} write
     * @returns {Promise<boolean>} false when another write got in first
     */
    save: ({ playerId, record, expected }) =>
      timeZoneDao.save({
        doc: {
          playerId,
          zone: record.zone,
          previousZone: record.previousZone,
          changedAt: new Date(record.changedAt),
          effectiveAt: new Date(record.effectiveAt),
          floorDay: record.floorDay,
        },
        expectedChangedAt: expected === undefined ? null : new Date(expected.changedAt),
      }),

    /** @param {string} playerId @returns {Promise<number>} records removed */
    remove: (playerId) => timeZoneDao.deleteByPlayer(playerId),
  });
}
