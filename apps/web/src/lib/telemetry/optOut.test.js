import { describe, expect, it } from "vitest";
import {
  isSwitchedOff,
  isTelemetryOff,
  setSwitchedOff,
  TELEMETRY_OFF,
  TELEMETRY_STORAGE_KEY,
} from "./optOut.js";

const memoryStorage = () => {
  const items = new Map();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
};
const SITE = { hostname: "nocapgaming.onrender.com" };
const BROWSER = { doNotTrack: null, webdriver: false };

describe("the usage counts switch (CC-174, ADR-034.3)", () => {
  it("is one key, cc.telemetry, holding only off, and turning counts back on removes it", () => {
    const storage = memoryStorage();

    expect(isSwitchedOff(() => storage)).toBe(false);
    expect(setSwitchedOff(() => storage, true)).toBe(true);
    expect([...storage.items]).toEqual([[TELEMETRY_STORAGE_KEY, TELEMETRY_OFF]]);
    expect(TELEMETRY_STORAGE_KEY).toBe("cc.telemetry");
    expect(isSwitchedOff(() => storage)).toBe(true);
    expect(setSwitchedOff(() => storage, false)).toBe(true);
    expect([...storage.items]).toEqual([]);
  });

  it("counts are off with the switch, GPC, DNT, a browser test or a laptop, and on otherwise", () => {
    const storage = memoryStorage();
    const off = (navigator, location = SITE) =>
      isTelemetryOff({ getStorage: () => storage, navigator, location });

    expect(off(BROWSER)).toBe(false);
    expect(off({ ...BROWSER, globalPrivacyControl: true })).toBe(true);
    expect(off({ ...BROWSER, doNotTrack: "1" })).toBe(true);
    expect(off({ ...BROWSER, doNotTrack: "0" })).toBe(false);
    expect(off({ ...BROWSER, webdriver: true })).toBe(true);
    expect(off(BROWSER, { hostname: "127.0.0.1" })).toBe(true);
    setSwitchedOff(() => storage, true);
    expect(off(BROWSER)).toBe(true);
  });

  it("a browser that refuses web storage counts as off, because its switch could never be turned off", () => {
    const refusing = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const broken = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(isSwitchedOff(refusing)).toBe(true);
    expect(isSwitchedOff(() => undefined)).toBe(true);
    expect(isSwitchedOff(() => broken)).toBe(true);
    expect(setSwitchedOff(refusing, true)).toBe(false);
    expect(setSwitchedOff(() => broken, true)).toBe(false);
    expect(setSwitchedOff(() => undefined, true)).toBe(false);
  });
});
