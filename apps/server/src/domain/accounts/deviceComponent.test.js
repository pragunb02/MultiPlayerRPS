import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { createDeviceComponent } from "./deviceComponent.js";

const RIYA = "user_0123456789abcdef01234567";
const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 60 * 60 * 1000;
const LIFETIME = 90 * 24 * HOUR;

const device = (deviceId, fields = {}) => ({
  sessionId: `session-of-${deviceId}`,
  sessionVersion: 3,
  signedInAt: NOW - 48 * HOUR,
  lastSeenAt: NOW - 2 * HOUR,
  deviceId,
  browser: "Chrome",
  system: "Android",
  ...fields,
});

/** The component over a fake session store holding `stored`, for an account at session version 3. */
function setup(stored) {
  const sessions = [...stored];
  const removed = [];
  const sessionAccessor = {
    devicesOf: async (playerId) => (playerId === RIYA ? sessions : []),
    removeSession: async ({ sessionId, playerId }) => {
      const index = sessions.findIndex((one) => one.sessionId === sessionId && playerId === RIYA);
      if (index === -1) return false;
      removed.push(sessionId);
      sessions.splice(index, 1);
      return true;
    },
  };
  const accounts = { sessionVersionOf: async () => 3 };
  const component = createDeviceComponent({ sessionAccessor, accounts, absoluteLifetimeMs: LIFETIME });
  return { component, removed, sessions };
}

describe("deviceComponent.listDevices (CC-262)", () => {
  it("lists this device first, then the others by when they were last seen", async () => {
    const { component } = setup([
      device("old", { lastSeenAt: NOW - 30 * HOUR }),
      device("laptop", { browser: "Firefox", system: "Windows" }),
      device("recent", { lastSeenAt: NOW - HOUR }),
    ]);

    const devices = await component.listDevices({ playerId: RIYA, currentDeviceId: "laptop", now: NOW });

    expect(devices.map((one) => one.deviceId)).toEqual(["laptop", "recent", "old"]);
    expect(devices[0]).toEqual({
      deviceId: "laptop",
      browser: "Firefox",
      system: "Windows",
      signedInAt: NOW - 48 * HOUR,
      lastSeenAt: NOW,
      current: true,
    });
    expect(devices[1].current).toBe(false);
    expect(devices[1].lastSeenAt).toBe(NOW - HOUR);
    expect(Object.isFrozen(devices)).toBe(true);
    expect(Object.isFrozen(devices[1])).toBe(true);
  });

  it("never names the session behind a device", async () => {
    const { component } = setup([device("laptop")]);

    const devices = await component.listDevices({ playerId: RIYA, currentDeviceId: "laptop", now: NOW });

    expect(JSON.stringify(devices)).not.toContain("session-of-");
  });

  it("leaves out sessions signed out by a newer session version or older than their lifetime", async () => {
    const { component } = setup([
      device("laptop"),
      device("signed-out", { sessionVersion: 2 }),
      device("too-old", { signedInAt: NOW - LIFETIME }),
    ]);

    const devices = await component.listDevices({ playerId: RIYA, currentDeviceId: "laptop", now: NOW });

    expect(devices.map((one) => one.deviceId)).toEqual(["laptop"]);
  });

  it("puts two devices seen at the same moment in a steady order", async () => {
    const { component } = setup([device("b"), device("a"), device("laptop")]);

    const devices = await component.listDevices({ playerId: RIYA, currentDeviceId: "laptop", now: NOW });

    expect(devices.map((one) => one.deviceId)).toEqual(["laptop", "a", "b"]);
  });
});

describe("deviceComponent.signOutDevice (CC-262)", () => {
  it("removes only that device's session and names it, so its sockets can be cut", async () => {
    const { component, removed } = setup([device("laptop"), device("phone"), device("tablet")]);

    const ended = await component.signOutDevice({
      playerId: RIYA,
      deviceId: "phone",
      currentDeviceId: "laptop",
      now: NOW,
    });

    expect(ended).toEqual({ sessionId: "session-of-phone" });
    expect(removed).toEqual(["session-of-phone"]);
  });

  it("refuses the device the player is using", async () => {
    const { component, removed } = setup([device("laptop")]);

    await expect(
      component.signOutDevice({ playerId: RIYA, deviceId: "laptop", currentDeviceId: "laptop", now: NOW }),
    ).rejects.toThrow(ValidationError);
    expect(removed).toEqual([]);
  });

  it.each([
    ["a device nobody has", "nobody", RIYA],
    ["another player's device", "phone", "user_ffffffffffffffffffffffff"],
  ])("answers not found for %s", async (_, deviceId, playerId) => {
    const { component, removed } = setup([device("laptop"), device("phone")]);

    await expect(
      component.signOutDevice({ playerId, deviceId, currentDeviceId: "laptop", now: NOW }),
    ).rejects.toThrow(NotFoundError);
    expect(removed).toEqual([]);
  });

  it("answers not found for a device already signed out by a newer session version", async () => {
    const { component } = setup([device("laptop"), device("phone", { sessionVersion: 2 })]);

    await expect(
      component.signOutDevice({ playerId: RIYA, deviceId: "phone", currentDeviceId: "laptop", now: NOW }),
    ).rejects.toThrow(NotFoundError);
  });

  it("answers not found when the session went away between the list and the removal", async () => {
    const racing = createDeviceComponent({
      sessionAccessor: {
        devicesOf: async () => [device("laptop"), device("phone")],
        removeSession: async () => false,
      },
      accounts: { sessionVersionOf: async () => 3 },
      absoluteLifetimeMs: LIFETIME,
    });

    await expect(
      racing.signOutDevice({ playerId: RIYA, deviceId: "phone", currentDeviceId: "laptop", now: NOW }),
    ).rejects.toThrow(NotFoundError);
  });

  it("fails fast without its dependencies", () => {
    expect(() => createDeviceComponent({})).toThrow(TypeError);
  });
});
