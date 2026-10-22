import { Router } from "express";
import { IDENTITY_KINDS } from "@classicade/shared";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ForbiddenError, ValidationError } from "../../utils/errors.js";
import { dayOf } from "../../utils/indiaTime.js";
import { requireIdentity } from "./session.js";

/** A device id as `newDevice` makes it: 16 random bytes in base64url. */
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

/** The signed-in account asking, with the device its session is on. Guests have no devices to list. */
function requireAccount(req) {
  const identity = requireIdentity(req.session);
  if (identity.kind !== IDENTITY_KINDS.USER) {
    throw new ForbiddenError("Only an account has signed-in devices");
  }
  return { playerId: identity.id, currentDeviceId: req.session.device.id };
}

/** One device as the browser gets it: its random id and India days, never the session behind it. */
const deviceResponse = (device) => ({
  id: device.deviceId,
  browser: device.browser,
  system: device.system,
  signedInDay: dayOf(device.signedInAt),
  lastSeenDay: dayOf(device.lastSeenAt),
  current: device.current,
});

/**
 * The account's signed-in devices over HTTP (CC-262, ADR-081).
 *
 * 1. `GET /auth/devices` answers `{ devices: [{ id, browser, system, signedInDay, lastSeenDay, current }] }`, this
 *    device first. Days are India days, "YYYY-MM-DD".
 * 2. `DELETE /auth/devices/:deviceId` signs that one other device out at once and answers 204. Its sockets are cut.
 *    Another account's device answers 404, like one that does not exist. The device asking answers 400: the normal
 *    log out signs it out.
 *
 * Guests get 403 and visitors 401.
 *
 * @param {{
 *   deviceComponent: ReturnType<typeof import("../../domain/accounts/deviceComponent.js").createDeviceComponent>,
 *   onSessionEnded: (sessionId: string) => void,
 *   now: () => number,
 * }} deps
 */
export function createDeviceRoutes({ deviceComponent, onSessionEnded, now }) {
  assertDefined(deviceComponent, "deviceComponent");
  assertFunction(onSessionEnded, "onSessionEnded");
  assertFunction(now, "now");
  const router = Router();

  router.get("/auth/devices", async (req, res) => {
    const devices = await deviceComponent.listDevices({ ...requireAccount(req), now: now() });
    res.json({ devices: devices.map(deviceResponse) });
  });

  router.delete("/auth/devices/:deviceId", async (req, res) => {
    const account = requireAccount(req);
    const { deviceId } = req.params;
    if (!DEVICE_ID.test(deviceId)) {
      throw new ValidationError("That is not a device id");
    }
    const { sessionId } = await deviceComponent.signOutDevice({ ...account, deviceId, now: now() });
    onSessionEnded(sessionId);
    req.log.info({ playerId: account.playerId }, "device signed out");
    res.status(204).end();
  });

  return router;
}
