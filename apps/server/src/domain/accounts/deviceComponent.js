import { assertDefined } from "../../utils/assert.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";

/**
 * @typedef {Object} DeviceView   what the owner of an account sees of one of its signed-in devices (CC-262)
 * @property {string} deviceId
 * @property {string} browser
 * @property {string} system
 * @property {number} signedInAt  ms
 * @property {number} lastSeenAt  ms
 * @property {boolean} current    the device asking
 */

/**
 * The devices an account is signed in on, and signing one of them out (CC-262, ADR-081). Only the account's own
 * sessions are ever read or removed, and a device is named only by its random device id, never by its session.
 *
 * @param {{
 *   sessionAccessor: Pick<ReturnType<typeof import("../../data/sessionAccessor.js").createSessionAccessor>, "devicesOf" | "removeSession">,
 *   accounts: { sessionVersionOf: (who: { playerId: string }) => Promise<number> },
 *   absoluteLifetimeMs: number,
 * }} deps  `absoluteLifetimeMs`: how long a signed-in session lasts at most (CC-116)
 */
export function createDeviceComponent({ sessionAccessor, accounts, absoluteLifetimeMs }) {
  assertDefined(sessionAccessor, "sessionAccessor");
  assertDefined(accounts, "accounts");
  assertDefined(absoluteLifetimeMs, "absoluteLifetimeMs");

  /**
   * The sessions that may still be used. "Sign out other devices" and a password change leave the old sessions in
   * the store, to be refused at their next request (ADR-030), and a session past its 90 days is refused too. Neither
   * is signed in any more, so neither is listed.
   */
  async function usableDevices({ playerId, now }) {
    const [version, devices] = await Promise.all([
      accounts.sessionVersionOf({ playerId }),
      sessionAccessor.devicesOf(playerId),
    ]);
    return devices.filter(
      (device) => device.sessionVersion === version && now - device.signedInAt < absoluteLifetimeMs,
    );
  }

  return Object.freeze({
    /**
     * The account's signed-in devices: the one asking first, then the others, most recently seen first. The one
     * asking is being seen right now.
     *
     * @param {{ playerId: string, currentDeviceId: string, now: number }} query
     * @returns {Promise<ReadonlyArray<Readonly<DeviceView>>>}
     */
    async listDevices({ playerId, currentDeviceId, now }) {
      const views = (await usableDevices({ playerId, now })).map((device) => {
        const current = device.deviceId === currentDeviceId;
        return Object.freeze({
          deviceId: device.deviceId,
          browser: device.browser,
          system: device.system,
          signedInAt: device.signedInAt,
          lastSeenAt: current ? now : device.lastSeenAt,
          current,
        });
      });
      return Object.freeze(
        views.sort(
          (a, b) =>
            Number(b.current) - Number(a.current) ||
            b.lastSeenAt - a.lastSeenAt ||
            a.deviceId.localeCompare(b.deviceId),
        ),
      );
    },

    /**
     * Signs one other device of the account out at once, by deleting its session. The device asking is signed out
     * by the normal log out instead, which also clears its cookie.
     *
     * @param {{ playerId: string, deviceId: string, currentDeviceId: string, now: number }} request
     * @returns {Promise<Readonly<{ sessionId: string }>>} the session that ended, so its sockets can be cut
     * @throws {ValidationError} for the device asking
     * @throws {NotFoundError} for a device that is not one of this account's signed-in devices
     */
    async signOutDevice({ playerId, deviceId, currentDeviceId, now }) {
      if (deviceId === currentDeviceId) {
        throw new ValidationError("This is the device you are using. Log out to sign it out.");
      }
      const device = (await usableDevices({ playerId, now })).find((one) => one.deviceId === deviceId);
      // Another account's device answers exactly like one that does not exist.
      const removed =
        device !== undefined &&
        (await sessionAccessor.removeSession({ sessionId: device.sessionId, playerId }));
      if (!removed) {
        throw new NotFoundError("That device is not signed in");
      }
      return Object.freeze({ sessionId: device.sessionId });
    },
  });
}
