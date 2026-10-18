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

const ON = { on: true, volume: 1 };
/** Every notification category at full volume, as stored. */
const ALL_ON = { request: ON, turn: ON, result: ON, reward: ON, social: ON, system: ON };

describe("soundPreferences (CC-103, CC-208)", () => {
  it("starts with sound on at a moderate volume, and every kind of notice on, when nothing was saved", () => {
    const preferences = createSoundPreferences({ getStorage: () => memoryStorage() });

    expect(preferences.load()).toEqual({ muted: false, volume: 0.6, categories: ALL_ON });
    expect(preferences.load()).toBe(DEFAULT_SOUND_SETTINGS);
  });

  it("keeps a choice under its one key and reads it back", () => {
    const storage = memoryStorage();
    const preferences = createSoundPreferences({ getStorage: () => storage });
    const categories = { ...ALL_ON, reward: { on: false, volume: 0.3 } };

    expect(preferences.save({ muted: true, volume: 0.25, categories })).toBe(true);

    expect([...storage.items.keys()]).toEqual([SOUND_STORAGE_KEY]);
    expect(SOUND_STORAGE_KEY).toBe("cc.sound");
    expect(JSON.parse(storage.items.get("cc.sound"))).toEqual({ muted: true, volume: 0.25, categories });
    expect(createSoundPreferences({ getStorage: () => storage }).load()).toEqual({
      muted: true,
      volume: 0.25,
      categories,
    });
  });

  it("stores only the known settings, whatever else the object carries", () => {
    const storage = memoryStorage();

    createSoundPreferences({ getStorage: () => storage }).save({
      muted: false,
      volume: 1,
      extra: "x",
      categories: { ...ALL_ON, turn: { on: true, volume: 0.5, loud: true } },
    });

    expect(JSON.parse(storage.items.get("cc.sound"))).toEqual({
      muted: false,
      volume: 1,
      categories: { ...ALL_ON, turn: { on: true, volume: 0.5 } },
    });
  });

  it("reads a choice saved before the kinds of notice existed, with every kind on", () => {
    const storage = memoryStorage({ "cc.sound": '{"muted":true,"volume":0.4}' });

    expect(createSoundPreferences({ getStorage: () => storage }).load()).toEqual({
      muted: true,
      volume: 0.4,
      categories: ALL_ON,
    });
  });

  it("fills in a kind of notice that a saved choice does not mention", () => {
    const storage = memoryStorage({
      "cc.sound": '{"muted":false,"volume":0.4,"categories":{"turn":{"on":false,"volume":0.2}}}',
    });

    expect(createSoundPreferences({ getStorage: () => storage }).load().categories).toEqual({
      ...ALL_ON,
      turn: { on: false, volume: 0.2 },
    });
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
    ["categories that are not an object", '{"muted":true,"volume":0.5,"categories":[1]}'],
    ["a category nobody knows", '{"muted":true,"volume":0.5,"categories":{"ads":{"on":true,"volume":1}}}'],
    ["a category with a bad switch", '{"muted":true,"volume":0.5,"categories":{"turn":{"on":1,"volume":1}}}'],
    ["a category too loud", '{"muted":true,"volume":0.5,"categories":{"turn":{"on":true,"volume":2}}}'],
    [
      "a category with extra fields",
      '{"muted":true,"volume":0.5,"categories":{"turn":{"on":true,"volume":1,"x":1}}}',
    ],
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
    expect(preferences.save(DEFAULT_SOUND_SETTINGS)).toBe(false);
  });

  it("reports a write that the browser refused, for example because storage is full", () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(createSoundPreferences({ getStorage: () => full }).save(DEFAULT_SOUND_SETTINGS)).toBe(false);
  });
});
