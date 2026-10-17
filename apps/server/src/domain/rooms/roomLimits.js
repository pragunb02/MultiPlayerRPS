/**
 * How much one player, one browser, one network and the whole server may use (CC-107). This is the one place
 * these business rules are written down. Without them a single visitor could open rooms and connections until the
 * one small server we run falls over (SEC-13).
 *
 * 1. A player may have at most `waitingRoomsPerPlayer` rooms waiting for an opponent at once. Three is enough to
 *    send one invite to each of a few friends. Anyone who needs more can close one first.
 * 2. The server holds at most `openRoomsMax` open rooms of any kind. Past that, creating a room answers "server
 *    busy, try again in a minute". Rooms close by themselves (see roomLifetimes.js), so space comes back quickly.
 *    Two thousand rooms is about four thousand players, far above what one small instance is sized for.
 * 3. One browser session may hold at most `socketsPerSession` realtime connections. That is one per open tab, and
 *    five tabs of the same game is already more than anyone plays.
 * 4. One network address may hold at most `socketsPerAddress` connections. A school or office behind one address
 *    stays well inside it, and a script on one machine cannot open thousands.
 * 5. Each player gets one budget of realtime events shared by all their tabs: bursts of up to
 *    `eventBurstPerPlayer`, refilled at `eventsPerSecondPerPlayer`. Opening more tabs does not buy more events.
 */
export const ROOM_LIMITS = Object.freeze({
  waitingRoomsPerPlayer: 3,
  openRoomsMax: 2000,
  socketsPerSession: 5,
  socketsPerAddress: 30,
  eventBurstPerPlayer: 20,
  eventsPerSecondPerPlayer: 10,
});

/** @typedef {typeof ROOM_LIMITS} RoomLimits */

/**
 * Checks a set of limits, filling in the standard value for any not given. Tests and browser tests use other
 * values (every browser test player shares one address, and one test fills the server on purpose). Production
 * always runs with the standard values.
 *
 * @param {Partial<RoomLimits>} [overrides]
 * @returns {Readonly<RoomLimits>}
 * @throws {TypeError} for an unknown name or a value that is not a positive whole number
 */
export function roomLimits(overrides = {}) {
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(ROOM_LIMITS, name)) {
      throw new TypeError(`Unknown room limit: ${name}`);
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Room limit ${name} must be a positive whole number`);
    }
  }
  return Object.freeze({ ...ROOM_LIMITS, ...overrides });
}
