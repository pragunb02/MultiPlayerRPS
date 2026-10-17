import { describe, expect, it } from "vitest";
import { createSoundPreferences, DEFAULT_SOUND_SETTINGS, SOUND_STORAGE_KEY } from "./soundPreferences.js";

/** Web storage in memory, like a browser's localStorage. */
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
  };
}

describe("soundPreferences (CC-103)", () => {
  it("starts with sound on at a moderate volume when nothing was saved", () => {
    const preferences = createSoundPreferences({ getStorage: () => memoryStorage() });

    expect(preferences.load()).toEqual({ muted: false, volume: 0.6 });
    expect(preferences.load()).toBe(DEFAULT_SOUND_SETTINGS);
  });

  it("keeps a choice under its one key and reads it back", () => {
    const storage = memoryStorage();
    const preferences = createSoundPreferences({ getStorage: () => storage });

    expect(preferences.save({ muted: true, volume: 0.25 })).toBe(true);

    expect([...storage.items.keys()]).toEqual([SOUND_STORAGE_KEY]);
    expect(SOUND_STORAGE_KEY).toBe("cc.sound");
    expect(JSON.parse(storage.items.get("cc.sound"))).toEqual({ muted: true, volume: 0.25 });
    expect(createSoundPreferences({ getStorage: () => storage }).load()).toEqual({
      muted: true,
      volume: 0.25,
    });
  });

  it("stores only the two settings, whatever else the object carries", () => {
    const storage = memoryStorage();

    createSoundPreferences({ getStorage: () => storage }).save({ muted: false, volume: 1, extra: "x" });

    expect(storage.items.get("cc.sound")).toBe('{"muted":false,"volume":1}');
  });

  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["a number", "3"],
    ["a missing field", '{"muted":true}'],
    ["an extra field", '{"muted":true,"volume":0.5,"x":1}'],
    ["a muted flag that is not true or false", '{"muted":"yes","volume":0.5}'],
    ["a volume that is not a number", '{"muted":true,"volume":"loud"}'],
    ["a volume above the top", '{"muted":true,"volume":1.5}'],
    ["a volume below zero", '{"muted":true,"volume":-0.1}'],
  ])("falls back to the defaults for a saved value that is %s", (_name, saved) => {
    const storage = memoryStorage({ "cc.sound": saved });

    expect(createSoundPreferences({ getStorage: () => storage }).load()).toBe(DEFAULT_SOUND_SETTINGS);
  });

  it("never breaks when storage is blocked: defaults to read, and the choice lasts for this visit only", () => {
    const blocked = () => {
      throw new Error("SecurityError: storage is disabled");
    };
    const preferences = createSoundPreferences({ getStorage: blocked });

    expect(preferences.load()).toBe(DEFAULT_SOUND_SETTINGS);
    expect(preferences.save({ muted: true, volume: 0.5 })).toBe(false);
  });

  it("reports a write that the browser refused, for example because storage is full", () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(createSoundPreferences({ getStorage: () => full }).save({ muted: false, volume: 0.5 })).toBe(
      false,
    );
  });
});
